/**
 * TypeScript → IR: functions, methods, constructors, modules'
 * initialization and compute task variants. The IR models evaluation
 * order, control flow (branches, loops, `for … of`, `switch`, labels,
 * `try`, `using`), places (locals, boxes closures share, module
 * variables, integer registers), closures, generics, exceptions and
 * suspension (`await`, `yield`). What it does not model itself (member
 * access, methods of the runtime and the SDK, constructions, literals of
 * arrays and objects) is a plan the host's `leaves` give, on operands
 * lowered here first. What Lucent rejects is a LUCENT diagnostic; what the
 * IR cannot lower throws IrUnsupported, which ir/cpp.ts reports as one.
 *
 * Every subexpression becomes operations appended in JavaScript's
 * evaluation order, left to right, so the order is fixed here once; a
 * right side that may not run (`&&`, `||`, `??`, `?:`) goes in a branch.
 */
import ts from "typescript";
import {
  enclosingFunction,
  type FunctionLike,
  freeVariables,
  isWriteTarget,
  parameterSymbol,
  symbolOf,
} from "../analysis/scopes.ts";
import { Codes, fail } from "../diagnostics.ts";
import { bigintLiteralValue } from "../lowering/literals.ts";
import { isVoidish, type LType, sameType, T, typeKey, unionOf } from "../types.ts";
import { IrBuilder } from "./build.ts";
import {
  binaryResult,
  isAbsent,
  type BinaryOp,
  type BuiltinName,
  type CaptureSource,
  type Constant,
  convertible,
  elementOf,
  type EffectSummary,
  type FunctionId,
  type IntKind,
  type IrFunction,
  type PlaceId,
  type Signature,
  type SourceSpan,
  type TargetId,
  unaryResult,
  type ValueId,
} from "./ir.ts";

/** A construct the IR does not lower yet. */
export class IrUnsupported extends Error {
  readonly node: ts.Node;
  /** What it is: "async generators", "optional chains"… */
  readonly what: string;

  constructor(node: ts.Node, what: string) {
    const sf = node.getSourceFile();
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    super(`the IR does not lower ${what} yet (${sf.fileName}:${line + 1}:${character + 1})`);
    this.name = "IrUnsupported";
    this.node = node;
    this.what = what;
  }
}

/** A declaration at the top level of a module, as the compiler knows it. */
export type IrGlobal =
  | {
      kind: "function";
      id: FunctionId;
      params: LType[];
      result: LType;
      /** Whether a call can be lowered: no optional or rest parameters, not generic or async. */
      callable: boolean;
      /** Its effects, when the program's analysis knows them. */
      effects?: EffectSummary;
    }
  | {
      kind: "var";
      id: string;
      name: string;
      type: LType;
      mutable: boolean;
      /** A constant's literal, which code reads instead of its storage. */
      literal?: ts.Expression;
    };

/** What lowering needs from the compiler: types and the module's declarations. */
export interface LowerHost {
  readonly checker: ts.TypeChecker;
  /** The type of the value at `node`, the checker's narrowing included. */
  typeAt(node: ts.Node): LType;
  /** The declared type of a variable. */
  typeOf(symbol: ts.Symbol, at: ts.Node): LType;
  /** A module function or variable (imports resolved), or undefined. */
  global(symbol: ts.Symbol): IrGlobal | undefined;
  /** Plans the expressions the IR does not model itself; without it, they are unsupported. */
  readonly leaves?: LeafHost;
  /**
   * Where a platform test (`PLATFORM === "ios" && …`) runs its branch: on
   * the platform being built (when the rest of the test holds), on another
   * (the other branch runs), or nowhere when the build has no platform.
   */
  platformGuard?(cond: ts.Expression): PlatformBranch | undefined;
  /** Of `switch (PLATFORM)`: whether the platform being built runs each clause, or "nowhere". */
  platformClauses?(s: ts.SwitchStatement): boolean[] | "nowhere" | undefined;
  /**
   * Whether the IR lowers `s`: the platform being built runs it (by the
   * platform branches and guard clauses around it), and it is the program's
   * code, no toolkit's (a component body's statements, a helper view).
   */
  runsHere?(s: ts.Statement): boolean;
  /** Whether `t`, a class, derives from Error. */
  isError?(t: LType): boolean;
  /** Whether class `sub` derives from class `base`. */
  derives?(sub: LType, base: LType): boolean;
  /** Whether closures share the variable `symbol` in a box: some code writes it after they capture it. */
  isBoxed?(symbol: ts.Symbol): boolean;
  /** A nested function's signature, `target` the function type it becomes when it has one. */
  signatureOf?(
    node: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
    target?: LType,
  ): NestedSignature;
  /** A nested function's effects, when the program's analysis knows them. */
  effectsOf?(node: FunctionLike): EffectSummary | undefined;
  /** The host a nested function's body lowers with (its leaves see `this` as the closure does). */
  nested?(node: FunctionLike, sig: NestedSignature): LowerHost;
  /** `this` as a value a closure `node` that uses it captures, as `self`; undefined when it has none. */
  self?(node: FunctionLike): Leaf | undefined;
  /** The ambient mount (see `LowerInput.ambient`) a function made at `node` enters when it runs. */
  enters?(node: FunctionLike): string | undefined;
  /** The name Errors made in the nested function `node` record as their site. */
  siteOf?(node: FunctionLike): string;
  /** Marks the names of a rejected declaration failed: their uses are not reported again. */
  markFailed?(name: ts.BindingName): void;
  /**
   * The locals of `fn` (not of the functions in it) every write of which
   * is an exact integer of a kind, which live in integer registers: `for`
   * counters as int64s.
   */
  integers?(fn: FunctionLike): ReadonlyMap<ts.Symbol, IntKind>;
}

/** A nested function's type, and what its parameters are. */
export interface NestedSignature {
  /** The function value's type. */
  type: LType & { k: "fn" };
  /** What the function takes: optionals for parameters with defaults, and those it leaves out. */
  params: LType[];
  /** Of a parameter with a default, the type its body sees (the caller passes an optional). */
  defaulted: (LType | undefined)[];
  async: boolean;
  generator: boolean;
}

export interface PlatformBranch {
  runs: "here" | "elsewhere" | "nowhere";
  /** What else the test needs, after the platform's. */
  rest: readonly ts.Expression[];
}

/**
 * An expression the IR leaves to the backend (a member read, a method of
 * the runtime or the SDK, a construction…): its plan, whose code names the
 * values of the subexpressions it takes as operands.
 */
export interface Leaf {
  /** What it does, for dumps. */
  name: string;
  code: unknown;
  /** What it gives: nothing when void-ish. */
  type: LType;
  /** Its value as an exact integer too, when the backend's code gives one. */
  int?: { code: unknown; kind: IntKind };
}

/** The subexpressions of a leaf, lowered before it in evaluation order. */
export interface LeafOperands {
  /** The value of `node`, a subexpression of the leaf (the same value when asked again), shaped by `hint`. */
  operand(node: ts.Expression, hint?: LType): ValueId;
  typeOf(v: ValueId): LType;
  /** Whether `symbol` names a local or a parameter of the function (or of one around it). */
  isLocal(symbol: ts.Symbol): boolean;
  /** The integer kind `v` is known to be an exact integer of, if any. */
  intOf(v: ValueId): IntKind | undefined;
  /** The function value of `node`, a function the leaf takes, as the type `target` it becomes. */
  closure(node: ts.ArrowFunction | ts.FunctionExpression, target?: LType): ValueId;
  /** The value of the ambient `name` (see `LowerInput.ambient`), here. */
  ambient(name: string, node: ts.Node): ValueId;
  /**
   * A function computing `node`, an expression the leaf runs later (each
   * time an effect does): it takes `thunk.params`, gives `thunk.type`.
   */
  thunk(node: ts.Expression, thunk?: Thunk): ValueId;
}

/** What a thunk (`LeafOperands.thunk`) takes and gives. */
export interface Thunk {
  /** Its parameters, each the value of the names given, in order. */
  params?: readonly { names: readonly ts.Symbol[]; type: LType }[];
  /** What it gives, converted; the type of its expression otherwise. */
  type?: LType;
  /** Where the code making it is, when not at its expression (a helper view's, where it is used). */
  site?: ts.Node;
  /**
   * What it computes first, in order, for what the expression reads
   * (a helper view's props): each `read` is then the value of `value`, or
   * undefined without one.
   */
  given?: readonly { read: ts.Expression; value?: ts.Expression }[];
}

/** A value a function's code may read that the backend declares around it (a setup's mount). */
export interface Ambient {
  name: string;
  type: LType;
  /** Its name in the backend's code. */
  spelled: string;
}

export interface LeafHost {
  /**
   * `node` as a plan, with `hint` the type its value becomes (a literal's
   * shape); throws IrUnsupported when it cannot plan it.
   */
  plan(node: ts.Expression, operands: LeafOperands, hint?: LType): Leaf;
  /** `value`, a `from`, as a `to`, where `convert` does not apply (an interface, a function's shape…). */
  convert(value: ValueId, from: LType, to: LType, node: ts.Node): Leaf;
  /** The place `target` names (a field, an element…), what it takes lowered as operands. */
  place(target: ts.Expression, operands: LeafOperands): LeafPlace;
  /** A part of `value`, a `from`, that destructuring takes: a field, an element, the rest. */
  part(value: ValueId, from: LType, which: PartOf, node: ts.Node): Leaf;
  /** What `for … in` goes over: `value`'s keys, as an array of strings. */
  keys(value: ValueId, from: LType, node: ts.Node): Leaf;
  /**
   * A link of an optional chain on `receiver`, a `from`: the member `node`
   * reads (a property or an element), the method it calls on it, or the
   * call of it; what else the link takes is lowered as operands.
   */
  link(
    receiver: ValueId,
    from: LType,
    node: ts.Expression,
    kind: "member" | "method" | "call",
    operands: LeafOperands,
  ): Leaf;
  /** A compute task's check for cancellation. */
  safepoint(): Leaf;
  /** `value`, a `bigint | number`, one up (`+`) or down: the kind it holds, stepped. */
  step(value: ValueId, from: LType, sign: "+" | "-", node: ts.Node): Leaf;
  /** `left === right` for operands the IR's operators do not compare (generics, objects). */
  equals(left: ValueId, leftType: LType, right: ValueId, rightType: LType, node: ts.Node): Leaf;
  /** A constructor's `super(…)`: its base class's construction, given the arguments as operands. */
  superCall(node: ts.CallExpression, operands: LeafOperands): Leaf;
  /** Disposing `value`, a present `from`, as a `using` declaration does. */
  dispose(value: ValueId, from: LType, node: ts.Node): Leaf;
  /** Whether it plans `node`, an optional chain, whole: one with no value to test (an event's call). */
  whole?(node: ts.Expression): boolean;
  /** What `node`, code for the platforms, gives in a build for neither: a `type` that throws. */
  platformOnly(node: ts.Node, type: LType): Leaf;
}

/** A part destructuring takes: a field by name, an element by index, the elements from an index on. */
export type PartOf = { name: string } | { index: number } | { rest: number };

/** A place a leaf names: reading it, and writing a value (an operand after the place's own). */
export interface LeafPlace {
  type: LType;
  get: Leaf;
  set(value: ValueId): Leaf;
}

/** What a name holds in a function: a parameter's value, or a place. */
type Variable = { value: ValueId } | { place: PlaceId; type: LType };

/** A link of an optional chain, and whether a `?.` short-circuits there. */
interface ChainLink {
  kind: "member" | "method" | "call" | "present";
  node: ts.Expression;
  optional: boolean;
}

/** What an assignment assigns to: a variable, or a place a leaf names. */
interface Target {
  type: LType;
  read(): ValueId;
  write(value: ValueId, source: SourceSpan): void;
}

/**
 * What a constructor or a module's initialization stores, in order: an
 * expression's value, a parameter, a string, or what the backend gives (a
 * type's default), as a `type`, into a module variable or a place the
 * backend writes (a field of `this`, a class's static field).
 */
export interface Initializer {
  value:
    | { expr: ts.Expression }
    | { param: ts.ParameterDeclaration }
    | { string: string }
    | { leaf: Leaf };
  type: LType;
  into: { variable: IrGlobal & { kind: "var" } } | { write(value: ValueId): Leaf };
}

/** The function to lower, with the types the compiler gave its signature. */
export interface LowerInput {
  /** The function; for code that only initializes, its module's file or its class. */
  decl: FunctionLike | ts.SourceFile | ts.ClassLikeDeclaration;
  /** What the function's code spans, when more than its declaration (a class's field initializers). */
  span?: ts.Node;
  /**
   * A constructor: it initializes these first, or, with a Lucent base
   * class, right after its `super(…)` call.
   */
  construct?: { initializers: Initializer[]; base: boolean };
  id: FunctionId;
  /** What callers pass: an optional for a parameter with a default. */
  params: LType[];
  /** Of a parameter with a default, the type its body sees. */
  defaulted?: (LType | undefined)[];
  /** What its body returns: for an async function, what its promise fulfils with. */
  result: LType;
  async: boolean;
  /** Of a generator, what it gives its caller each time. */
  generator?: LType;
  generic: boolean;
  /** A compute task's variant: each loop iteration checks for cancellation. */
  task?: boolean;
  /**
   * Values its code may read that the backend declares around it: each
   * one read is a capture of the function, and of the closures that read
   * it, by its name.
   */
  ambient?: readonly Ambient[];
  /** Its effects, when the program's analysis knows them. */
  effects?: EffectSummary;
}

export interface Lowered {
  fn: IrFunction;
  /** The signatures of the functions it calls, for the verifier. */
  signatures: ReadonlyMap<FunctionId, Signature>;
  /** The effects of the functions it calls, where known, for the verifier. */
  effects: ReadonlyMap<FunctionId, EffectSummary>;
}

export function lower(input: LowerInput, host: LowerHost): Lowered {
  return new Lowerer(input, host).function();
}

/**
 * Code that only initializes: a module's `init()`, or the constructor a
 * class does not declare. It takes `params`; `first` runs before its
 * initializers (an implicit constructor's base construction, on the
 * parameters), then each initializer, in order.
 */
export interface Initialization {
  id: FunctionId;
  /** Where its code is: the module's file, or the class. */
  source: ts.SourceFile | ts.ClassLikeDeclaration;
  params?: LType[];
  first?: (params: ValueId[]) => Leaf;
  initializers: Initializer[];
  effects?: EffectSummary;
}

export function lowerInit(init: Initialization, host: LowerHost): Lowered {
  const input: LowerInput = {
    decl: init.source,
    id: init.id,
    params: init.params ?? [],
    result: T.void,
    async: false,
    generic: false,
    ...(init.effects ? { effects: init.effects } : {}),
  };

  return new Lowerer(input, host).initialization(init);
}

const ERRORS: Record<string, BuiltinName> = {
  Error: "new Error",
  TypeError: "new TypeError",
  RangeError: "new RangeError",
};

/** Library values an identifier can name. */
const LIBRARY_CONSTANTS: Record<string, number | undefined> = {
  undefined: undefined,
  NaN: Number.NaN,
  Infinity: Infinity,
};

/** A loop, labeled block or switch that `break` or `continue` can name. */
interface Jump {
  target: TargetId;
  kind: "loop" | "block" | "switch";
  labels: readonly string[];
}

class Lowerer {
  readonly b: IrBuilder;
  readonly host: LowerHost;
  readonly signatures = new Map<FunctionId, Signature>();
  readonly effects = new Map<FunctionId, EffectSummary>();
  /** The type the function gives. */
  readonly result: LType;
  private readonly input: LowerInput;
  private readonly params = new Map<ts.Symbol, ValueId>();
  private readonly locals = new Map<ts.Symbol, PlaceId>();
  private readonly localTypes = new Map<PlaceId, LType>();
  /** The loops, labeled blocks and switches around the statement being lowered, innermost last. */
  private readonly jumps: Jump[] = [];
  /** The values leaves give. */
  private readonly planned = new Set<ValueId>();
  /** The function this one is nested in, whose variables it captures. */
  private readonly parent?: Lowerer;
  /**
   * The variables of enclosing functions this one captures, and the
   * ambients (by name), in the order it first uses them.
   */
  private readonly captured = new Map<ts.Symbol | string, { place: PlaceId; outer: Variable }>();
  /** Values that the code it lowers reads instead of what an expression computes (a thunk's given). */
  private readonly bound = new Map<ts.Node, ValueId>();
  /** The places closures share in a box. */
  private readonly boxed = new Set<PlaceId>();
  /** Nested function declarations defined where they are written: they capture a later variable. */
  private readonly deferred = new Set<ts.FunctionDeclaration>();
  private closures = 0;

  constructor(input: LowerInput, host: LowerHost, parent?: Lowerer) {
    this.input = input;
    this.host = host;
    this.result = input.result;
    this.parent = parent;
    this.b = new IrBuilder(
      input.id,
      input.result,
      spanOf(input.span ?? input.decl),
      input.async,
      input.generator,
    );
  }

  function(): Lowered {
    const d = this.input.decl;

    if (ts.isSourceFile(d) || ts.isClassLike(d)) this.unsupported(d, "initializing as a function");

    if (!d.body) this.unsupported(d, "functions without a body");

    const body = d.body;
    // A callback takes the parameters of the function type it becomes, even those it leaves out.
    const values = this.input.params.map((t, i) =>
      this.b.param(i, t, spanOf(d.parameters[i] ?? d)),
    );

    d.parameters.forEach((p, i) => this.parameter(p, values[i]!, this.input.defaulted?.[i], body));

    const construct = this.input.construct;

    if (construct && !construct.base) this.initialize(construct.initializers);

    if (ts.isBlock(body)) {
      this.statements(body.statements);
      this.end(d);
    } else this.returns(body, spanOf(body));

    const fn = this.b.finish(this.input.effects);

    return { fn, signatures: this.signatures, effects: this.effects };
  }

  /** A module's initialization: each initializer in order. */
  initialization(init: Initialization): Lowered {
    const span = spanOf(init.source);
    const params = this.input.params.map((t, i) => this.b.param(i, t, span));

    if (init.first) this.planOf(init.first(params), params, span);

    this.initialize(init.initializers);

    const fn = this.b.finish(this.input.effects);

    return { fn, signatures: this.signatures, effects: this.effects };
  }

  /** Stores each initializer's value into its variable or place, in order. */
  initialize(initializers: readonly Initializer[]): void {
    const host = this.host.leaves;

    for (const init of initializers) {
      const { value, type, into } = init;
      const span = spanOf(
        "expr" in value ? value.expr : "param" in value ? value.param : this.input.decl,
      );
      const v =
        "expr" in value
          ? this.coerce(this.expr(value.expr, type), type, value.expr)
          : "param" in value
            ? this.coerce(this.parameterValue(value.param), type, value.param)
            : "string" in value
              ? this.b.const(value.string, span)
              : this.planOf(value.leaf, [], span);

      if ("variable" in into) {
        const g = into.variable;

        // Initializing stores into the module's constants too.
        this.b.store(this.b.modulePlace(g.id, g.name, g.type, true), v, span);
      } else {
        if (!host) this.unsupported(this.input.decl, "initializing fields");

        this.planOf(into.write(v), [v], span);
      }
    }
  }

  /** A parameter's value, read where the function starts. */
  parameterValue(p: ts.ParameterDeclaration): ValueId {
    const sym = parameterSymbol(
      this.host.checker,
      p as ts.ParameterDeclaration & { name: ts.Identifier },
    );
    const v = this.variableOf(sym);

    if (!v) this.unsupported(p, "a parameter that is not a name");

    return "value" in v ? v.value : this.b.load(v.place, spanOf(p));
  }

  /** `super(…)` in a constructor: the base class's construction, then this class's initializers. */
  superCall(call: ts.CallExpression): void {
    const host = this.host.leaves;
    const construct = this.input.construct;

    // Of a class that is not Lucent's (an Error's), it is the emitter's.
    if (!construct?.base) {
      this.leaf(call);
      return;
    }

    if (!host) this.unsupported(call, "super() here");

    const { operands, args } = this.operands();

    this.planOf(host.superCall(call, operands), args, spanOf(call));
    this.initialize(construct.initializers);
  }

  /**
   * A parameter: its value, or a local starting as it when the body assigns
   * it, closures share it, or a default replaces an undefined argument.
   */
  parameter(
    p: ts.ParameterDeclaration,
    value: ValueId,
    defaulted: LType | undefined,
    body: ts.Node,
  ): void {
    if (!ts.isIdentifier(p.name)) {
      const init = p.initializer;

      // The default when the argument is undefined, then the pattern's parts.
      if (init && defaulted) {
        const span = spanOf(p);
        const absent = this.b.binary("===", value, this.b.const(undefined, span), span);
        const given = this.b.if(
          absent,
          span,
          () => this.b.yield(this.coerce(this.expr(init, defaulted), defaulted, init), span),
          () => this.b.yield(this.coerce(value, defaulted, p), span),
          defaulted,
        )!;

        this.bind(p.name, given);
        return;
      }

      this.bind(p.name, value);
      return;
    }

    // A parameter property's own symbol, which its constructor's body names.
    const sym = parameterSymbol(
      this.host.checker,
      p as ts.ParameterDeclaration & { name: ts.Identifier },
    );
    const span = spanOf(p);
    const local =
      defaulted !== undefined ||
      assignedIn(this.host.checker, body, sym) ||
      this.host.isBoxed?.(sym);

    if (!local) {
      this.params.set(sym, value);
      return;
    }

    const type = defaulted ?? this.b.typeOf(value);
    const place = this.declareLocal(sym, p.name.text, type, p);
    const init = p.initializer;

    if (!init) {
      this.b.store(place, value, span);
      return;
    }

    const absent = this.b.binary("===", value, this.b.const(undefined, span), span);

    this.b.if(
      absent,
      span,
      () => this.b.store(place, this.coerce(this.expr(init, type), type, init), span),
      () => this.b.store(place, this.coerce(value, type, p), span),
    );
  }

  /**
   * After the last statement of a body: a function that may give undefined
   * gives it, and one TypeScript proved always returns (an exhaustive
   * switch at the end) cannot get here.
   */
  end(d: FunctionLike): void {
    if (!this.b.completes || isVoidish(this.result)) return;

    const span = spanOf(d);
    const absent = convertible(T.undefined, this.result);

    if (absent) this.b.return(this.coerce(this.b.const(undefined, span), this.result, d), span);
    else this.b.unreachable(span);
  }

  /** `return value`: converted to what the function gives (nothing, from a void one). */
  returns(value: ts.Expression, span: SourceSpan): void {
    const result = this.result;

    if (this.input.generator)
      fail(
        value.parent,
        Codes.UnsupportedSyntax,
        "generators cannot return a value; use `return;`",
      );

    let v = this.expr(value, isVoidish(result) ? undefined : result);

    // An async function returning a promise returns what it fulfils with.
    if (this.input.async && this.b.typeOf(v).k === "promise" && result.k !== "promise")
      v = this.awaited(v, value);

    if (isVoidish(result)) {
      this.b.return(undefined, span);
      return;
    }

    this.b.return(this.coerce(v, result, value), span);
  }

  /** `await v`: what a promise fulfils with (undefined for a promise of void); any other value as it is. */
  awaited(v: ValueId, node: ts.Node): ValueId {
    const t = this.b.typeOf(v);

    const held = t.k === "opt" ? t.inner : t;

    if (!this.input.async) fail(node, Codes.UnsupportedSyntax, "`await` outside an async function");

    // A native object is no promise, whatever its API: the listener or callback that reports its
    // completion, adapted with fromCallback, is.
    if (held.k === "native")
      fail(
        node,
        Codes.AwaitNative,
        `\`await\` does not wait for a native ${held.name}: it is not a promise. Wrap the listener or callback that reports its completion in fromCallback (lucent:core) and await that promise`,
      );

    if (t.k !== "promise") {
      if (held.k === "promise")
        fail(node, Codes.UnsupportedSyntax, "awaiting an optional promise is not supported");

      return v;
    }

    const span = spanOf(node);
    const inner = isVoidish(t.inner) ? undefined : t.inner;

    return this.b.await(v, inner, span) ?? this.b.const(undefined, span);
  }

  /**
   * `yield x;` gives the generator's caller `x`; `yield* xs;` gives it each
   * element of `xs` in turn (closing the generator closes an iterator `xs`).
   */
  yieldStatement(y: ts.YieldExpression): void {
    const element = this.input.generator;
    const span = spanOf(y);

    if (!element) fail(y, Codes.UnsupportedSyntax, "`yield` outside a generator");

    if (!y.asteriskToken) {
      const v = y.expression ? this.expr(y.expression, element) : this.b.const(undefined, span);

      this.b.produce(this.coerce(v, element, y), span);
      return;
    }

    const source = this.expr(y.expression!);
    const t = this.b.typeOf(source);
    const whole = t.k === "opt" ? this.coerce(source, t.inner, y.expression!) : source;
    const each = elementOf(this.b.typeOf(whole));

    if (!each) fail(y.expression!, Codes.UnsupportedLoop, `${typeKey(t)} is not iterable`);

    this.b.iterate(span, whole, each, (_target, el) =>
      this.b.produce(this.coerce(el, element, y), span),
    );
  }

  unsupported(node: ts.Node, what: string): never {
    throw new IrUnsupported(node, what);
  }

  /** The symbol a name refers to: a shorthand property's is the variable's. */
  symbol(id: ts.Identifier): ts.Symbol {
    const sym = symbolOf(this.host.checker, id);

    if (!sym) this.unsupported(id, `the unresolved name ${id.text}`);

    return sym;
  }

  /** The type at `node`: one the compiler cannot represent is reported (a LUCENT diagnostic). */
  typeAt(node: ts.Node): LType {
    return this.host.typeAt(node);
  }

  /** A variable's declared type; one the compiler cannot represent is reported. */
  declaredType(sym: ts.Symbol, at: ts.Node): LType {
    return this.host.typeOf(sym, at);
  }

  statement(s: ts.Statement): void {
    if (this.host.runsHere?.(s) === false) return;

    const lower = STATEMENTS[s.kind] as ((s: ts.Statement, lw: Lowerer) => void) | undefined;

    if (!lower) this.unsupported(s, `${ts.SyntaxKind[s.kind]} statements`);

    lower(s, this);
  }

  /** Statements in order, up to one that leaves: what follows it never runs. */
  statements(list: readonly ts.Statement[]): void {
    this.hoist(list);
    this.rest(list);
  }

  /**
   * Statements of a list whose functions are hoisted. After a `using`
   * declaration, the rest of the list runs guarded, and disposing is its
   * finally.
   */
  rest(list: readonly ts.Statement[]): void {
    for (const [i, s] of list.entries()) {
      if (this.b.ended) return;

      if (ts.isVariableStatement(s) && s.declarationList.flags & ts.NodeFlags.Using) {
        this.using(s.declarationList, () => this.rest(list.slice(i + 1)));
        return;
      }

      this.statement(s);
    }
  }

  /**
   * `using a = …, b = …;` then `rest`: each value disposed (when it is not
   * null or undefined) however what follows it is left, in reverse order.
   */
  using(list: ts.VariableDeclarationList, rest: () => void): void {
    if ((list.flags & ts.NodeFlags.AwaitUsing) === ts.NodeFlags.AwaitUsing)
      fail(list, Codes.UnsupportedSyntax, "`await using` is not supported; use `using`");

    const each = (decls: readonly ts.VariableDeclaration[]): void => {
      const [d, ...more] = decls;

      if (!d) {
        rest();
        return;
      }

      if (!ts.isIdentifier(d.name) || !d.initializer)
        fail(d, Codes.UnsupportedDestructuring, "a using declaration names one value");

      const sym = this.symbol(d.name);
      const type = this.declaredType(sym, d.name);
      const value = this.coerce(this.expr(d.initializer, type), type, d.initializer);
      const place = this.declareLocal(sym, d.name.text, type, d);
      const span = spanOf(d);

      this.b.store(place, value, span);
      this.b.try(
        span,
        () => each(more),
        undefined,
        () => this.dispose(this.b.load(place, span), d),
      );
    };

    each(list.declarations);
  }

  /** Disposes a `using` value: nothing for null or undefined. */
  dispose(value: ValueId, node: ts.Node): void {
    const host = this.host.leaves;
    const t = this.b.typeOf(value);
    const span = spanOf(node);

    if (!host) this.unsupported(node, "using");

    if (isAbsent(t)) return;

    if (t.k !== "opt") {
      this.b.dispose(value, host.dispose(value, t, node).code, span);
      return;
    }

    const absent = this.b.binary("==", value, this.b.const(null, span), span);

    this.b.if(
      absent,
      span,
      () => {},
      () => {
        const present = this.b.convert(value, t.inner, span);

        this.b.dispose(present, host.dispose(present, t.inner, node).code, span);
      },
    );
  }

  /** `try`: its block; its catch, with the error bound; its finally, however they are left. */
  tryStatement(s: ts.TryStatement): void {
    const caught = s.catchClause;
    const final = s.finallyBlock;
    const span = spanOf(s);

    this.b.try(
      span,
      () => this.statements(s.tryBlock.statements),
      caught &&
        ((error) => {
          const v = caught.variableDeclaration;

          if (v && !ts.isIdentifier(v.name))
            fail(v, Codes.UnsupportedDestructuring, "destructuring in catch is not supported");

          if (v) {
            const name = v.name as ts.Identifier;
            const place = this.declareLocal(this.symbol(name), name.text, T.error, v);

            this.b.store(place, error, spanOf(v));
          }

          this.statements(caught.block.statements);
        }),
      final && (() => this.statements(final.statements)),
    );
  }

  /**
   * Nested function declarations, which JavaScript hoists: each is a boxed
   * local from the start of its block, defined there; one that captures a
   * variable the block declares is defined where it is written, the
   * variable being in its temporal dead zone before that anyway.
   */
  hoist(list: readonly ts.Statement[]): void {
    const fns = list
      .filter(ts.isFunctionDeclaration)
      .filter((f) => this.host.runsHere?.(f) !== false);

    if (!fns.length) return;

    const declared = new Set(
      list.filter(ts.isVariableStatement).flatMap((v) => this.declaredBy(v)),
    );

    for (const f of fns) {
      if (!f.name) this.unsupported(f, "a function declaration without a name");

      const sym = this.symbol(f.name);
      const type = this.signature(f).type;

      this.declareLocal(sym, f.name.text, type, f, true);

      if (freeVariables(this.host.checker, f).some((v) => declared.has(v))) this.deferred.add(f);
    }

    for (const f of fns) if (!this.deferred.has(f)) this.define(f);
  }

  /** The variables a statement declares, destructured ones included. */
  declaredBy(s: ts.VariableStatement): ts.Symbol[] {
    const out: ts.Symbol[] = [];
    const visit = (n: ts.Node): void => {
      if (
        ts.isIdentifier(n) &&
        (ts.isVariableDeclaration(n.parent) || ts.isBindingElement(n.parent))
      ) {
        const sym = this.host.checker.getSymbolAtLocation(n);

        if (sym) out.push(sym);
      }

      ts.forEachChild(n, visit);
    };

    for (const d of s.declarationList.declarations) visit(d.name);
    return out;
  }

  /** A nested function declaration's statement: where one that captures a later variable is defined. */
  defineDeferred(f: ts.FunctionDeclaration): void {
    if (this.deferred.has(f)) this.define(f);
  }

  /** Stores the closure of a nested function declaration into its hoisted local. */
  define(f: ts.FunctionDeclaration): void {
    const { place, type } = this.place(f.name!);

    this.b.store(place, this.coerce(this.closure(f), type, f), spanOf(f));
  }

  /** The body of an if branch or a loop: its region is already a scope of its own. */
  nested(s: ts.Statement): void {
    if (ts.isBlock(s)) this.statements(s.statements);
    else this.statement(s);
  }

  /** `build()` with `jump` as a target `break` and `continue` can name. */
  within(jump: Jump, build: () => void): void {
    this.jumps.push(jump);

    try {
      build();
    } finally {
      this.jumps.pop();
    }
  }

  /** The target a `break` or `continue` leaves. */
  jumpTarget(s: ts.BreakStatement | ts.ContinueStatement): TargetId {
    const label = s.label?.text;
    const loop = ts.isContinueStatement(s);
    const jump = this.jumps.findLast((j) =>
      label ? j.labels.includes(label) : j.kind === "loop" || (!loop && j.kind === "switch"),
    );

    if (!jump || (loop && jump.kind !== "loop"))
      this.unsupported(s, `a ${loop ? "continue" : "break"} without a target`);

    return jump.target;
  }

  /**
   * A loop over `node`'s body, leaving when `condition` (tested first, or
   * last) is false. Each iteration gets its own copy of the `perIteration`
   * variables (a `for`'s `let` variables closures share), as in JavaScript.
   */
  loop(
    node: ts.IterationStatement,
    labels: readonly string[],
    parts: {
      condition?: ts.Expression;
      testFirst: boolean;
      step?: () => void;
      perIteration?: readonly ts.Symbol[];
    },
  ): void {
    const { condition, testFirst, step, perIteration = [] } = parts;
    const body = (loop: TargetId) =>
      this.within({ target: loop, kind: "loop", labels }, () => {
        if (condition && testFirst) this.exitUnless(condition, loop);

        this.safepoint(node);

        const restore = perIteration.map((sym) => this.iterationCopy(sym, node));

        this.nested(node.statement);
        restore.forEach((r) => r());
      });
    const next =
      step ??
      (condition && !testFirst ? (loop: TargetId) => this.exitUnless(condition, loop) : undefined);

    this.b.loop(spanOf(node), body, next);
  }

  /** The variables of a `for`'s declarations that closures share and its body does not assign. */
  iterationVariables(list: ts.VariableDeclarationList, body: ts.Statement): ts.Symbol[] {
    return list.declarations.flatMap((d) => {
      const sym = ts.isIdentifier(d.name)
        ? this.host.checker.getSymbolAtLocation(d.name)
        : undefined;
      const place = sym && this.locals.get(sym);

      return sym &&
        place !== undefined &&
        this.boxed.has(place) &&
        !assignedIn(this.host.checker, body, sym)
        ? [sym]
        : [];
    });
  }

  /** A copy of the boxed loop variable `sym` for one iteration; the function restores the variable. */
  iterationCopy(sym: ts.Symbol, node: ts.Node): () => void {
    const place = this.locals.get(sym)!;
    const type = this.localTypes.get(place)!;
    const span = spanOf(node);
    const copy = this.b.local(`${sym.name}_it`, type, span, true);

    this.b.store(copy, this.b.load(place, span), span);
    this.boxed.add(copy);
    this.locals.set(sym, copy);
    this.localTypes.set(copy, type);

    return () => this.locals.set(sym, place);
  }

  /** In a compute task's variant, where each loop iteration starts: a check for cancellation. */
  safepoint(node: ts.Node): void {
    const host = this.host.leaves;

    if (!this.input.task) return;

    if (!host) this.unsupported(node, "a compute task's loops");

    this.planOf(host.safepoint(), [], spanOf(node));
  }

  /** `if (!condition) break loop;` (nothing for a literal `true`). */
  exitUnless(condition: ts.Expression, loop: TargetId): void {
    if (condition.kind === ts.SyntaxKind.TrueKeyword) return;

    const span = spanOf(condition);
    const stop = this.b.unary("!", this.condition(condition), span);

    this.b.if(
      stop,
      span,
      () => this.b.break(loop, span),
      () => {},
    );
  }

  /**
   * `let`/`const` declarations, each initializer run before its variable
   * exists; but a variable closures share already has its box, which a
   * closure in its own initializer (a recursive arrow) captures.
   */
  declarations(list: ts.VariableDeclarationList): void {
    const scoped = list.flags & ts.NodeFlags.BlockScoped;

    if (scoped !== ts.NodeFlags.Let && scoped !== ts.NodeFlags.Const) this.varDeclarations(list);

    for (const d of list.declarations) {
      if (!ts.isIdentifier(d.name)) {
        if (!d.initializer) this.unsupported(d, "a destructuring declaration without a value");

        this.bind(d.name, this.expr(d.initializer));
        continue;
      }

      const sym = this.symbol(d.name);
      const declared = this.declaredType(sym, d.name);
      const type = declared.k === "never" ? T.undefined : declared;
      const boxed = this.host.isBoxed?.(sym) === true;
      const early = boxed ? this.declareLocal(sym, d.name.text, type, d) : undefined;
      const value =
        d.initializer && this.coerce(this.expr(d.initializer, type), type, d.initializer);
      const place = early ?? this.declareLocal(sym, d.name.text, type, d);

      if (value !== undefined) this.b.store(place, value, spanOf(d));
    }
  }

  /** `var`, which Lucent rejects: its names are marked failed, so their uses are not reported again. */
  varDeclarations(list: ts.VariableDeclarationList): never {
    for (const d of list.declarations) this.host.markFailed?.(d.name);

    fail(list, Codes.UnsupportedSyntax, "use `let` or `const` instead of `var`");
  }

  /**
   * A binding name given `value`: a new variable, or each part of a
   * destructuring pattern in order (a field, an element, the rest of an
   * array), with its default when the part is undefined.
   */
  bind(name: ts.BindingName, value: ValueId): void {
    if (ts.isIdentifier(name)) {
      const sym = this.symbol(name);
      const declared = this.declaredType(sym, name);
      const type = declared.k === "never" ? T.undefined : declared;
      const place = this.declareLocal(sym, name.text, type, name);

      this.b.store(place, this.coerce(value, type, name), spanOf(name));
      return;
    }

    if (ts.isObjectBindingPattern(name)) {
      for (const el of name.elements) {
        const key = el.propertyName ?? el.name;

        if (el.dotDotDotToken)
          fail(el, Codes.UnsupportedDestructuring, "object rest in destructuring is not supported");

        if (!ts.isIdentifier(key) && !ts.isStringLiteral(key))
          fail(
            el,
            Codes.UnsupportedDestructuring,
            "computed keys in destructuring are not supported",
          );

        const part = this.part(value, { name: key.text }, el);

        this.bind(el.name, el.initializer ? this.withDefault(part, el.initializer, el) : part);
      }
      return;
    }

    name.elements.forEach((el, i) => {
      if (ts.isOmittedExpression(el)) return;

      const part = this.part(value, el.dotDotDotToken ? { rest: i } : { index: i }, el);

      this.bind(el.name, el.initializer ? this.withDefault(part, el.initializer, el) : part);
    });
  }

  /** A part of a destructured value, as the backend reads it. */
  part(value: ValueId, which: PartOf, node: ts.Node): ValueId {
    const host = this.host.leaves;

    if (!host) this.unsupported(node, "destructuring");

    return this.planOf(host.part(value, this.b.typeOf(value), which, node), [value], spanOf(node));
  }

  /** `v`, or `init` when `v` is undefined (not null), as JavaScript's defaults are. */
  withDefault(v: ValueId, init: ts.Expression, node: ts.Node): ValueId {
    if (this.b.typeOf(v).k !== "opt") return v;

    const target = this.typeAt(node);
    const span = spanOf(node);
    const absent = this.b.binary("===", v, this.b.const(undefined, span), span);

    return this.b.if(
      absent,
      span,
      () => this.b.yield(this.coerce(this.expr(init, target), target, init), span),
      () => this.b.yield(this.coerce(v, target, node), span),
      target,
    )!;
  }

  /**
   * `[a, b] = v`, `({ x, y: z } = v)`: each target in order, evaluated
   * before the part of `v` it gets, with its default when that is undefined.
   */
  assignPattern(pattern: ts.Expression, value: ValueId): void {
    const assign = (target: ts.Expression, part: () => ValueId) => {
      const withDefault =
        ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.EqualsToken;
      const into = withDefault ? target.left : target;

      if (ts.isArrayLiteralExpression(into) || ts.isObjectLiteralExpression(into)) {
        const v = part();

        this.assignPattern(into, withDefault ? this.withDefault(v, target.right, target) : v);
        return;
      }

      const t = this.target(into);
      const v = part();
      const given = withDefault ? this.withDefault(v, target.right, target) : v;

      t.write(this.coerce(given, t.type, target), spanOf(target));
    };

    if (ts.isArrayLiteralExpression(pattern)) {
      pattern.elements.forEach((el, i) => {
        if (ts.isOmittedExpression(el)) return;

        if (ts.isSpreadElement(el))
          fail(
            el,
            Codes.UnsupportedDestructuring,
            "rest elements in destructuring assignments are not supported",
          );

        assign(el, () => this.part(value, { index: i }, el));
      });
      return;
    }

    if (!ts.isObjectLiteralExpression(pattern)) this.unsupported(pattern, "this assignment target");

    for (const p of pattern.properties) {
      if (ts.isShorthandPropertyAssignment(p)) {
        const part = () => this.part(value, { name: p.name.text }, p);
        const init = p.objectAssignmentInitializer;
        const t = this.target(p.name);
        const v = part();
        const given = init ? this.withDefault(v, init, p) : v;

        t.write(this.coerce(given, t.type, p), spanOf(p));
      } else if (
        ts.isPropertyAssignment(p) &&
        (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
      ) {
        const key = p.name.text;

        assign(p.initializer, () => this.part(value, { name: key }, p));
      } else
        fail(
          p,
          Codes.UnsupportedDestructuring,
          "only named properties can be destructured in assignments",
        );
    }
  }

  /** `for (x of xs)`: the body for each element, bound to a new variable (or assigned). */
  forOf(s: ts.ForOfStatement, labels: readonly string[]): void {
    if (s.awaitModifier) fail(s, Codes.UnsupportedLoop, "`for await` is not supported");

    const iterable = this.expr(s.expression);
    const t = this.b.typeOf(iterable);
    const whole = t.k === "opt" ? this.coerce(iterable, t.inner, s.expression) : iterable;

    this.each(s, labels, whole);
  }

  /** `for (k in o)`: the body for each key, as strings: a record's, an object's fields, an array's indexes. */
  forIn(s: ts.ForInStatement, labels: readonly string[]): void {
    const host = this.host.leaves;
    const object = this.expr(s.expression);

    if (!host) this.unsupported(s, "for in");

    const keys = host.keys(object, this.b.typeOf(object), s.expression);

    this.each(s, labels, this.planOf(keys, [object], spanOf(s.expression)));
  }

  /** The body of a `for … of` or `for … in` for each element of `iterable`. */
  each(
    s: ts.ForOfStatement | ts.ForInStatement,
    labels: readonly string[],
    iterable: ValueId,
  ): void {
    const t = this.b.typeOf(iterable);
    const element = elementOf(t);

    if (!element) fail(s.expression, Codes.UnsupportedLoop, `cannot iterate over ${typeKey(t)}`);

    this.b.iterate(spanOf(s), iterable, element, (target, value) =>
      this.within({ target, kind: "loop", labels }, () => {
        const init = s.initializer;

        this.safepoint(s);

        if (ts.isVariableDeclarationList(init)) {
          const scoped = init.flags & ts.NodeFlags.BlockScoped;

          if (scoped !== ts.NodeFlags.Let && scoped !== ts.NodeFlags.Const)
            this.varDeclarations(init);

          this.bind(init.declarations[0]!.name, value);
        } else if (ts.isArrayLiteralExpression(init) || ts.isObjectLiteralExpression(init)) {
          this.assignPattern(init, value);
        } else {
          const target = this.target(init);

          target.write(this.coerce(value, target.type, init), spanOf(init));
        }

        this.nested(s.statement);
      }),
    );
  }

  /**
   * `switch`: the index of the clause that matches (the case tests in
   * order, then the default), then every clause from it on, until a
   * `break` leaves the block around them. With a default, some clause
   * always matches, so the last one runs untested: a switch whose
   * clauses all return then visibly returns.
   */
  switch(s: ts.SwitchStatement, labels: readonly string[]): void {
    const clauses = s.caseBlock.clauses;
    const platforms = this.host.platformClauses?.(s);

    // Its scope would be the whole switch, disposed after the clauses that fall through.
    for (const c of clauses)
      for (const x of c.statements)
        if (ts.isVariableStatement(x) && x.declarationList.flags & ts.NodeFlags.Using)
          fail(x, Codes.UnsupportedSyntax, "wrap a using declaration in a case clause in a block");

    if (platforms === "nowhere") {
      this.nowhere(s);
      return;
    }

    // `switch (PLATFORM)`: the clauses the platform runs, in order, in a block `break` leaves.
    if (platforms) {
      this.b.block(
        spanOf(s),
        (target) =>
          this.within({ target: target!, kind: "switch", labels }, () =>
            clauses.forEach((c, i) => {
              if (platforms[i]) this.b.block(spanOf(c), () => this.statements(c.statements));
            }),
          ),
        true,
      );
      return;
    }

    if (sharesDeclarations(this.host.checker, clauses))
      this.unsupported(s, "declarations one switch clause shares with another");

    this.b.block(
      spanOf(s),
      (target) =>
        this.within({ target: target!, kind: "switch", labels }, () => {
          const d = this.expr(s.expression);
          const fallback = clauses.findIndex(ts.isDefaultClause);
          const cases = clauses.flatMap((c, i) => (ts.isCaseClause(c) ? [{ c, i }] : []));
          const match = (k: number): ValueId => {
            const next = cases[k];

            if (!next) return this.b.const(fallback >= 0 ? fallback : clauses.length, spanOf(s));

            const span = spanOf(next.c);
            const test = this.equals(d, this.expr(next.c.expression), next.c);

            return this.b.if(
              test,
              span,
              () => this.b.yield(this.b.const(next.i, span), span),
              () => this.b.yield(match(k + 1), span),
              T.number,
            )!;
          };
          const matched = match(0);
          const last = clauses.length - 1;

          clauses.forEach((c, i) => {
            if (!c.statements.length) return;

            if (i === last && fallback >= 0) {
              this.statements(c.statements);
              return;
            }

            const span = spanOf(c);
            const runs = this.b.binary("<=", matched, this.b.const(i, span), span);

            this.b.if(
              runs,
              span,
              () => this.statements(c.statements),
              () => {},
            );
          });
        }),
      true,
    );
  }

  /**
   * Operations computing `node`, in evaluation order; the value they give.
   * `hint` is the type it becomes, which shapes literals the backend plans.
   */
  expr(node: ts.Expression, hint?: LType): ValueId {
    const bound = this.bound.get(node);

    if (bound !== undefined) return bound;

    if (isChain(node) && !this.host.leaves?.whole?.(node)) return this.chain(node);

    const lower = EXPRESSIONS[node.kind] as
      | ((n: ts.Expression, lw: Lowerer, hint?: LType) => ValueId)
      | undefined;
    const v = lower ? lower(node, this, hint) : this.leaf(node, hint);

    // A leaf's type is the backend's: narrowed where the checker narrows, a literal's as its hint shapes it.
    if (this.planned.has(v)) return v;

    const given = this.b.typeOf(v);
    let checked: LType;

    // A type the compiler cannot represent (a catch variable's `unknown`) narrows nothing.
    try {
      checked = this.host.typeAt(node);
    } catch {
      return v;
    }

    // An optional the checker proved absent here is the constant, once it ran; but `null |
    // undefined` is lowered as undefined and may hold either, so that optional stays as it is.
    if (given.k === "opt" && isAbsent(checked)) {
      const type = this.host.checker.getTypeAtLocation(node);
      const members = type.isUnion() ? type.types : [type];

      if (checked.k === "undefined" && members.some((m) => m.flags & ts.TypeFlags.Null)) return v;

      return this.b.const(checked.k === "null" ? null : undefined, spanOf(node));
    }

    // The checker narrowed the value here (an optional known present, a union's member).
    const derives = (sub: LType, base: LType) => this.host.derives?.(sub, base) === true;

    return narrows(given, checked, derives) ? this.coerce(v, checked, node) : v;
  }

  /**
   * `node` as a plan of the backend's, after the subexpressions it takes,
   * each lowered once, in evaluation order (the order of the source).
   * Optional chains short-circuit, which a plan's operands cannot.
   */
  leaf(node: ts.Expression, hint?: LType): ValueId {
    const host = this.host.leaves;

    if (!host) this.unsupported(node, `${ts.SyntaxKind[node.kind]} expressions`);

    const { operands, args } = this.operands();

    return this.planOf(host.plan(node, operands, hint), args, spanOf(node));
  }

  /**
   * An optional chain (`a?.b.c`, `a?.[i]`, `a?.m()`, `f?.()`): its base,
   * then each link in turn on the value before it; at a `?.` whose value
   * is null or undefined, the whole chain is undefined, and nothing after
   * it (an argument, an index) runs.
   */
  chain(root: ts.Expression): ValueId {
    const links: ChainLink[] = [];
    let base: ts.Expression = root;

    while (isChain(base)) {
      const n: ts.Expression = base;

      if (ts.isNonNullExpression(n)) {
        links.unshift({ kind: "present", node: n, optional: false });
        base = n.expression;
      } else if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
        links.unshift({ kind: "member", node: n, optional: !!n.questionDotToken });
        base = n.expression;
      } else {
        const call = n as ts.CallExpression;
        const callee = call.expression;

        // `a?.m()` calls the method m of `a`; `f?.()` and `a.f?.()` call a function value.
        if (ts.isPropertyAccessExpression(callee) && !call.questionDotToken) {
          links.unshift({ kind: "method", node: call, optional: !!callee.questionDotToken });
          base = callee.expression;
        } else {
          links.unshift({ kind: "call", node: call, optional: !!call.questionDotToken });
          base = callee;
        }
      }
    }

    return this.links(this.expr(base), links, root);
  }

  /**
   * `links` on `v`, in order. Once a `?.` may short-circuit, the chain gives
   * what the links after it give, or undefined: its own type, as the links'
   * types make it, not the checker's (which may not be its representation).
   */
  links(v: ValueId, links: readonly ChainLink[], root: ts.Node): ValueId {
    const [link, ...rest] = links;

    if (!link) return v;

    const t = this.b.typeOf(v);
    const span = spanOf(link.node);
    const absent = t.k === "opt" || isAbsent(t) || (t.k === "union" && t.ms.some(isAbsent));

    if (link.optional && absent) {
      const test = this.b.binary("==", v, this.b.const(null, span), span);

      return this.b.choose(
        test,
        span,
        () => this.links(this.present(v, link.node), links, root),
        (given) => unionOf([given, T.undefined]),
        (type) => this.coerce(this.b.const(undefined, span), type, link.node),
        (given, type) => this.coerce(given, type, root),
      );
    }

    return this.links(this.apply(link, v), rest, root);
  }

  /** A value known not to be null or undefined: an optional's value, a union without its absent members. */
  present(v: ValueId, node: ts.Node): ValueId {
    const t = this.b.typeOf(v);

    if (t.k === "opt") return this.b.convert(v, t.inner, spanOf(node));

    if (t.k === "union") {
      const ms = t.ms.filter((m) => !isAbsent(m));

      return this.coerce(v, ms.length === 1 ? ms[0]! : { k: "union", ms }, node);
    }

    return v;
  }

  /** One link of a chain on the value before it: a member, a method call, a call, or `!`. */
  apply(link: ChainLink, receiver: ValueId): ValueId {
    if (link.kind === "present") return this.present(receiver, link.node);

    const host = this.host.leaves;

    if (!host) this.unsupported(link.node, "optional chains");

    const { operands, args } = this.operands();
    const from = this.b.typeOf(receiver);
    const planned = host.link(receiver, from, link.node, link.kind, operands);

    return this.planOf(planned, [receiver, ...args], spanOf(link.node));
  }

  /** The operands a leaf asks for, each lowered once, in the order of the source. */
  operands(): { operands: LeafOperands; args: ValueId[] } {
    const args: ValueId[] = [];
    const lowered = new Map<ts.Expression, ValueId>();
    let end = -1;
    const take = (n: ts.Expression, lower: () => ValueId) => {
      const known = lowered.get(n);

      if (known !== undefined) return known;

      // An operand asked for after one that follows it in the source: fine when those already
      // lowered after it are pure, so evaluating them first is not observable.
      const after = [...lowered.keys()].filter((k) => k.getStart() >= n.getEnd());

      if (n.getStart() < end && !after.every((k) => this.pure(k)))
        this.unsupported(n, "operands a plan takes out of order");

      const v = lower();

      lowered.set(n, v);
      args.push(v);
      end = Math.max(end, n.getEnd());
      return v;
    };
    const operands: LeafOperands = {
      operand: (n, hint) => take(n, () => this.expr(n, hint)),
      closure: (n, target) => take(n, () => this.closure(n, target)),
      // Making a function runs none of its code: each is its own, made in any order.
      thunk: (n, thunk) => {
        const v = this.thunk(n, thunk ?? {});

        args.push(v);
        return v;
      },
      ambient: (name, node) => {
        const v = this.ambient(name, node);

        args.push(v);
        return v;
      },
      typeOf: (v) => this.b.typeOf(v),
      intOf: (v) => this.b.intOf(v),
      isLocal: (sym) => this.variableOf(sym) !== undefined,
    };

    return { operands, args };
  }

  /** The plan `leaf` on `args`; one that gives nothing gives undefined, once it ran. */
  planOf(leaf: Leaf, args: ValueId[], span: SourceSpan): ValueId {
    const result = isVoidish(leaf.type) ? undefined : leaf.type;
    const v =
      this.b.plan(leaf.name, leaf.code, args, result, span, leaf.int) ??
      this.nothing(leaf.type, span);

    this.planned.add(v);
    return v;
  }

  /** What an operation that gives nothing gives: undefined, or no value when it never completes. */
  nothing(type: LType, span: SourceSpan): ValueId {
    return type.k === "never" ? this.b.never(span) : this.b.const(undefined, span);
  }

  /** What `node` assigns to; a place other than a variable has what it takes lowered now. */
  target(node: ts.Expression): Target {
    if (this.variable(node)) {
      const { place, type } = this.place(node);

      return {
        type,
        read: () => this.b.load(place, spanOf(node)),
        write: (v, span) => this.b.store(place, v, span),
      };
    }

    const host = this.host.leaves;
    const inner = skipParentheses(node);

    if (!host || ts.isArrayLiteralExpression(inner) || ts.isObjectLiteralExpression(inner))
      this.unsupported(node, "assigning to anything but a variable");

    if (node.flags & ts.NodeFlags.OptionalChain) this.unsupported(node, "optional chains");

    const { operands, args } = this.operands();
    const place = host.place(node, operands);

    return {
      type: place.type,
      read: () => this.planOf(place.get, args, spanOf(node)),
      write: (v, span) => void this.planOf(place.set(v), [...args, v], span),
    };
  }

  /** `x as T`: `x`, shaped and converted as a `T` (`as const` changes nothing). */
  asserted(node: ts.AsExpression | ts.TypeAssertion): ValueId {
    const inner = node.expression;

    if (ts.isTypeReferenceNode(node.type) && node.type.typeName.getText() === "const")
      return this.expr(inner);

    const target = this.typeAt(node);

    return this.coerce(this.expr(inner, target), target, node);
  }

  /**
   * Whether evaluating `node` has no effect and gives the same whenever it
   * runs: a literal, a function (its closure copies only variables nothing
   * writes after they are captured), a parameter the body never assigns, or
   * a `const`.
   */
  pure(node: ts.Expression): boolean {
    const n = skipParentheses(node);

    if (LITERALS[n.kind] || n.kind === ts.SyntaxKind.NullKeyword) return true;

    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) return true;

    if (!ts.isIdentifier(n)) return false;

    const sym = symbolOf(this.host.checker, n);
    const decl = sym?.valueDeclaration;
    const constant =
      decl !== undefined &&
      ts.isVariableDeclaration(decl) &&
      (ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const) !== 0;

    return sym !== undefined && (this.params.has(sym) || constant);
  }

  /** Whether `target` is a variable the IR stores into: a local or a module variable. */
  variable(target: ts.Expression): boolean {
    const id = skipParentheses(target);
    const sym = ts.isIdentifier(id) ? symbolOf(this.host.checker, id) : undefined;

    if (sym === undefined) return false;

    const local = this.variableOf(sym);

    return local ? "place" in local : this.host.global(sym)?.kind === "var";
  }

  /** A condition: a boolean as it is, anything else through ToBoolean. */
  condition(node: ts.Expression): ValueId {
    return this.truthy(this.expr(node), node);
  }

  truthy(v: ValueId, node: ts.Node): ValueId {
    return this.b.typeOf(v).k === "boolean" ? v : this.b.unary("!!", v, spanOf(node));
  }

  /** `v` as a `to`: the same value, in the representation `to` has. */
  coerce(v: ValueId, to: LType, node: ts.Node): ValueId {
    const from = this.b.typeOf(v);

    if (sameType(from, to)) return v;

    if (convertible(from, to)) return this.b.convert(v, to, spanOf(node));

    const host = this.host.leaves;

    if (!host) this.unsupported(node, `converting a ${typeKey(from)} to ${typeKey(to)}`);

    const planned = host.convert(v, from, to, node);
    const span = spanOf(node);

    return (
      this.b.plan(planned.name, planned.code, [v], isVoidish(to) ? undefined : to, span) ??
      this.b.const(undefined, span)
    );
  }

  /** A string for the `+` and template operands that are not strings (ToString). */
  string(v: ValueId, node: ts.Node): ValueId {
    const t = this.b.typeOf(v);

    if (t.k === "string") return v;

    if (unaryResult("String", t)) return this.b.unary("String", v, spanOf(node));

    this.unsupported(node, `converting a ${typeKey(t)} to a string`);
  }

  /** The place an identifier names: a local, or a module variable. */
  place(id: ts.Expression): { place: PlaceId; type: LType } {
    if (ts.isParenthesizedExpression(id)) return this.place(id.expression);

    if (!ts.isIdentifier(id)) this.unsupported(id, "assigning to anything but a variable");

    const sym = this.symbol(id);
    const local = this.variableOf(sym);

    if (local && "place" in local) return local;

    if (local) this.unsupported(id, `assigning to the parameter ${id.text}`);

    const g = this.host.global(sym);

    if (g?.kind !== "var") this.unsupported(id, `the name ${id.text}`);

    return { place: this.b.modulePlace(g.id, g.name, g.type, g.mutable), type: g.type };
  }

  /** A local; boxed when closures share it (`always`, a nested function declaration). */
  declareLocal(sym: ts.Symbol, name: string, type: LType, node: ts.Node, always = false): PlaceId {
    const boxed = always || this.host.isBoxed?.(sym) === true;
    // A number local every write of which is an exact integer lives in an integer register.
    const int = !boxed && type.k === "number" ? this.integers().get(sym) : undefined;
    const place = this.b.local(name, type, spanOf(node), boxed, int);

    this.locals.set(sym, place);
    this.localTypes.set(place, type);

    if (boxed) this.boxed.add(place);

    return place;
  }

  private ints?: ReadonlyMap<ts.Symbol, IntKind>;

  /** The function's locals that live in integer registers, as the host's analysis finds them. */
  integers(): ReadonlyMap<ts.Symbol, IntKind> {
    const d = this.input.decl;

    this.ints ??=
      ts.isSourceFile(d) || ts.isClassLike(d) ? new Map() : (this.host.integers?.(d) ?? new Map());

    return this.ints;
  }

  /** What `sym` names here: a parameter's value, a local, or a variable of an enclosing function. */
  variableOf(sym: ts.Symbol): Variable | undefined {
    const param = this.params.get(sym);

    if (param !== undefined) return { value: param };

    const local = this.locals.get(sym);

    if (local !== undefined) return { place: local, type: this.localTypes.get(local)! };

    const known = this.captured.get(sym);

    if (known) return { place: known.place, type: this.b.placeType(known.place) };

    const outer = this.parent?.variableOf(sym);

    if (!outer) return undefined;

    // Captured: a copy of what the enclosing function holds, or its box.
    const parent = this.parent!;
    const boxed = "place" in outer && parent.boxed.has(outer.place);
    const type = "value" in outer ? parent.b.typeOf(outer.value) : outer.type;
    const names = new Set(
      [...this.captured.keys()].map((k) => (typeof k === "string" ? k : k.name)),
    );
    const name = names.has(sym.name) ? `${sym.name}_${names.size}` : sym.name;
    const place = this.b.capture(name, type, boxed);

    if (boxed) this.boxed.add(place);

    this.captured.set(sym, { place, outer });
    return { place, type };
  }

  /**
   * A nested function as a function value, `target` the type it becomes:
   * lowered on its own, then made a closure of what it captures (copies of
   * the values, or the boxes, of the variables of this function and those
   * around it).
   */
  closure(
    node: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
    target?: LType,
  ): ValueId {
    const sig = this.signature(node, target);

    const ret = sig.type.ret;

    if (sig.async && sig.generator)
      fail(node, Codes.UnsupportedSyntax, "async generators are not supported");

    if (sig.generator && ret.k !== "iter")
      fail(node, Codes.UnsupportedSyntax, "annotate generators with Generator<T> or Iterable<T>");

    const id = `${this.input.id}$${++this.closures}`;
    const input: LowerInput = {
      decl: node,
      id,
      params: sig.params,
      defaulted: sig.defaulted,
      // An async function's body returns what its promise fulfils with; a generator's, nothing.
      result: sig.async && ret.k === "promise" ? ret.inner : sig.generator ? T.void : ret,
      async: sig.async,
      ...(sig.generator && ret.k === "iter" ? { generator: ret.e } : {}),
      generic: false,
    };
    const effects = this.host.effectsOf?.(node);
    const host = this.host.nested?.(node, sig) ?? this.host;
    const child = new Lowerer(effects ? { ...input, effects } : input, host, this);
    // A closure using `this` captures it first, as `self`, which its leaves name.
    const self = this.host.self?.(node);

    if (self) child.b.capture("this", self.type, false, "self");

    child.b.site = this.host.siteOf?.(node);

    const lowered = child.function();
    const span = spanOf(node);
    const captured = this.captures(child, lowered, span);
    const from = self ? [{ value: this.planOf(self, [], span) }, ...captured] : captured;
    const mount = this.host.enters?.(node);
    const enters = mount === undefined ? undefined : this.ambient(mount, node);

    return this.b.closure(lowered.fn, from, sig.type, span, enters);
  }

  /** What the closure `child` lowered captures, from this function; what it calls is known here too. */
  captures(child: Lowerer, lowered: Lowered, span: SourceSpan): CaptureSource[] {
    for (const [k, v] of lowered.signatures) this.signatures.set(k, v);

    for (const [k, v] of lowered.effects) this.effects.set(k, v);

    return [...child.captured.values()].map(({ outer }): CaptureSource => {
      if ("value" in outer) return { value: outer.value };

      return this.boxed.has(outer.place)
        ? { box: outer.place }
        : { value: this.b.load(outer.place, span) };
    });
  }

  /** A function of `node`, an expression its caller computes later, as `thunk` describes it. */
  thunk(node: ts.Expression, thunk: Thunk): ValueId {
    const params = thunk.params?.map((p) => p.type) ?? [];
    const result = thunk.type ?? this.typeAt(node);
    const input: LowerInput = {
      decl: enclosingFunction(node) ?? node.getSourceFile(),
      span: node,
      id: `${this.input.id}$${++this.closures}`,
      params,
      result,
      async: false,
      generic: false,
    };
    const child = new Lowerer(input, this.host, this);

    child.b.site = this.b.site;

    const lowered = child.computes(node, thunk);
    const span = spanOf(thunk.site ?? node);
    const type: LType = { k: "fn", params, ret: result };

    return this.b.closure(lowered.fn, this.captures(child, lowered, span), type, span);
  }

  /** A thunk's body: its parameters named, what it is given computed, then `node` returned. */
  computes(node: ts.Expression, thunk: Thunk): Lowered {
    const span = spanOf(node);

    thunk.params?.forEach((p, i) => {
      const value = this.b.param(i, p.type, span);

      for (const name of p.names) this.params.set(name, value);
    });

    for (const g of thunk.given ?? []) {
      const value = g.value;

      if (value) this.b.elsewhere.push(spanOf(value));

      this.bound.set(g.read, value ? this.expr(value) : this.b.const(undefined, span));
    }

    this.returns(node, span);

    const fn = this.b.finish(this.input.effects);

    return { fn, signatures: this.signatures, effects: this.effects };
  }

  /** The ambient `name` (`LowerInput.ambient`), read at `node`: captured from the functions around this one. */
  ambient(name: string, node: ts.Node): ValueId {
    const found = this.ambientOf(name);

    if (!found) this.unsupported(node, `${name} here`);

    return this.b.load(found.place, spanOf(node));
  }

  ambientOf(name: string): { place: PlaceId; type: LType } | undefined {
    const known = this.captured.get(name);

    if (known) return { place: known.place, type: this.b.placeType(known.place) };

    if (!this.parent) {
      const declared = this.input.ambient?.find((a) => a.name === name);

      if (!declared) return undefined;

      const place = this.b.capture(name, declared.type, false, declared.spelled);

      this.captured.set(name, { place, outer: { place, type: declared.type } });
      return { place, type: declared.type };
    }

    const outer = this.parent.ambientOf(name);

    if (!outer) return undefined;

    const place = this.b.capture(name, outer.type, false, this.parent.spelledAmbient(name));

    this.captured.set(name, { place, outer });
    return { place, type: outer.type };
  }

  /** The name the backend's code gives the ambient `name`, in every function that reads it. */
  spelledAmbient(name: string): string | undefined {
    return this.parent
      ? this.parent.spelledAmbient(name)
      : this.input.ambient?.find((a) => a.name === name)?.spelled;
  }

  /** A nested function's signature, as the host gives it. */
  signature(
    node: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
    target?: LType,
  ): NestedSignature {
    if (!this.host.signatureOf) this.unsupported(node, "nested functions");

    try {
      return this.host.signatureOf(node, target);
    } catch (e) {
      if (e instanceof IrUnsupported) throw e;

      this.unsupported(node, "this function's type");
    }
  }

  identifier(id: ts.Identifier): ValueId {
    const sym = symbolOf(this.host.checker, id);
    const local = sym && this.variableOf(sym);

    if (local) return "value" in local ? local.value : this.b.load(local.place, spanOf(id));

    // `undefined` has a symbol without declarations; NaN and Infinity are the library's.
    const constant =
      Object.hasOwn(LIBRARY_CONSTANTS, id.text) &&
      (!sym || !sym.declarations?.length || isLibrary(sym));

    if (!sym || constant) {
      if (!constant) return this.leaf(id);

      return this.b.const(LIBRARY_CONSTANTS[id.text], spanOf(id));
    }

    const g = this.host.global(sym);

    // A function as a value, a platform's or the SDK's constant…
    if (g?.kind !== "var") return this.leaf(id);

    // A literal constant is read as its literal, not from module storage.
    if (g?.kind === "var" && g.literal)
      return this.coerce(this.b.const(literalValue(g.literal), spanOf(id)), g.type, id);

    return this.b.load(this.place(id).place, spanOf(id));
  }

  /** A call of a module function; any other call is a plan. */
  call(node: ts.CallExpression, hint?: LType): ValueId {
    const callee = node.expression;
    const sym = ts.isIdentifier(callee) ? this.host.checker.getSymbolAtLocation(callee) : undefined;
    const local = sym !== undefined && (this.locals.has(sym) || this.params.has(sym));
    const g = sym === undefined || local ? undefined : this.host.global(sym);
    const direct =
      !node.questionDotToken &&
      !node.typeArguments &&
      g?.kind === "function" &&
      g.callable &&
      node.arguments.length === g.params.length;

    // A compute task's code calls the module's functions' task variants, which the backend names.
    if (!direct || this.input.task) return this.leaf(node, hint);

    const args = node.arguments.map((a, i) =>
      this.coerce(this.expr(a, g.params[i]), g.params[i]!, a),
    );
    const result = isVoidish(g.result) ? undefined : g.result;

    this.signatures.set(g.id, { params: g.params, result: g.result });

    if (g.effects) this.effects.set(g.id, g.effects);

    const v = this.b.call(
      { kind: "function", id: g.id },
      args,
      result,
      { throws: g.effects?.throws ?? "unknown", summary: g.id },
      spanOf(node),
    );

    // Calling a function that gives nothing gives undefined.
    return v ?? this.nothing(g.result, spanOf(node));
  }

  /** `new Error(message)` and its kinds; any other construction is a plan. */
  newExpr(node: ts.NewExpression): ValueId {
    const callee = node.expression;
    const builtin = ts.isIdentifier(callee) ? ERRORS[callee.text] : undefined;
    const args = node.arguments ?? [];
    const sym = ts.isIdentifier(callee) ? this.host.checker.getSymbolAtLocation(callee) : undefined;

    if (!builtin || !sym || !isLibrary(sym) || args.length > 1) return this.leaf(node);

    if (args[0] && this.typeAt(args[0]).k !== "string") return this.leaf(node);

    const text = args[0] ? this.expr(args[0]) : this.b.const("", spanOf(node));

    return this.b.call(
      { kind: "builtin", name: builtin },
      [text],
      T.error,
      { throws: "no" },
      spanOf(node),
    )!;
  }

  binary(node: ts.BinaryExpression): ValueId {
    const kind = node.operatorToken.kind;
    const form = BINARY_FORMS[kind];

    if (form) return form(node, this);

    const compound = COMPOUND[kind];

    // A right side that never gives a value: the target is read, then it throws.
    if (compound && this.typeAt(node.right).k === "never") {
      const target = this.target(node.left);

      target.read();

      const never = this.expr(node.right);

      target.write(this.coerce(never, target.type, node), spanOf(node));
      return never;
    }

    if (compound && !this.takes(compound, this.typeAt(node.left), this.typeAt(node.right)))
      this.unsupported(node, `${compound}= on a ${typeKey(this.typeAt(node.left))}`);

    if (compound) {
      // The target is read before the right side runs, as in JavaScript.
      const target = this.target(node.left);
      const current = this.coerce(target.read(), this.typeAt(node.left), node.left);
      const value = this.operator(compound, current, this.expr(node.right), node);

      target.write(this.coerce(value, target.type, node), spanOf(node));
      return value;
    }

    const op = BINARY[kind];

    // Decided from the checker's types before anything runs, so no operand is lowered twice.
    if (!op || !this.takes(op, this.typeAt(node.left), this.typeAt(node.right)))
      return this.leaf(node);

    const left = this.expr(node.left);

    return this.operator(op, left, this.expr(node.right), node);
  }

  /** `left === right`: the IR's operator where it takes them, the backend's otherwise. */
  equals(left: ValueId, right: ValueId, node: ts.Node): ValueId {
    const [l, r] = [this.b.typeOf(left), this.b.typeOf(right)];
    const host = this.host.leaves;

    if (this.takes("===", l, r) || !host) return this.operator("===", left, right, node);

    return this.planOf(host.equals(left, l, right, r, node), [left, right], spanOf(node));
  }

  /** Whether the IR's operator `op` takes a `left` and a `right` (strings concatenate with what prints). */
  takes(op: BinaryOp, left: LType, right: LType): boolean {
    const concat = op === "+" && (left.k === "string" || right.k === "string");

    if (!concat) return binaryResult(op, left, right) !== undefined;

    return [left, right].every((t) => t.k === "string" || unaryResult("String", t) !== undefined);
  }

  /** `left op right`, the operands converted as JavaScript does for the types the IR takes. */
  operator(op: BinaryOp, left: ValueId, right: ValueId, node: ts.Node): ValueId {
    const [l, r] = [this.b.typeOf(left), this.b.typeOf(right)];
    const concat = op === "+" && (l.k === "string" || r.k === "string");
    const [a, b] = concat ? [this.string(left, node), this.string(right, node)] : [left, right];

    if (!binaryResult(op, this.b.typeOf(a), this.b.typeOf(b)))
      this.unsupported(node, `${op} on a ${typeKey(l)} and a ${typeKey(r)}`);

    return this.b.binary(op, a, b, spanOf(node));
  }

  /**
   * `a && b`, `a || b`, `a ?? b`: the left side, then the right one only
   * when the left does not decide; the result is one of them, as the
   * checker types the whole expression.
   */
  logical(node: ts.BinaryExpression, kind: "&&" | "||" | "??"): ValueId {
    const type = this.typeAt(node);
    const left = this.expr(node.left);
    const leftType = this.b.typeOf(left);

    if (kind === "??" && leftType.k !== "opt")
      return leftType.k === "undefined" || leftType.k === "null"
        ? this.coerce(this.expr(node.right), type, node)
        : this.coerce(left, type, node);

    const span = spanOf(node);
    const test =
      kind === "??"
        ? this.b.binary("==", left, this.b.const(null, span), span)
        : this.truthy(left, node.left);
    const keep = () => this.b.yield(this.coerce(left, type, node.left), span);
    const other = () => this.b.yield(this.coerce(this.expr(node.right), type, node.right), span);

    // `||` keeps a truthy left side; `&&` runs the right side then, and `??` when the left is absent.
    return kind === "||"
      ? this.b.if(test, span, keep, other, type)!
      : this.b.if(test, span, other, keep, type)!;
  }

  /** `x ??= v`, `x ||= v`, `x &&= v`: `v` runs, and is stored, only when the test passes. */
  logicalAssign(node: ts.BinaryExpression, kind: "&&" | "||" | "??"): ValueId {
    const type = this.typeAt(node);
    const target = this.target(node.left);
    const span = spanOf(node);
    const current = target.read();
    const test =
      kind === "??"
        ? this.b.binary("==", current, this.b.const(null, span), span)
        : this.truthy(current, node.left);
    const keep = () => this.b.yield(this.coerce(current, type, node.left), span);
    const assign = () => {
      const value = this.expr(node.right, target.type);

      target.write(this.coerce(value, target.type, node.right), span);
      this.b.yield(this.coerce(value, type, node.right), span);
    };

    return kind === "||"
      ? this.b.if(test, span, keep, assign, type)!
      : this.b.if(test, span, assign, keep, type)!;
  }

  /** `x++`, `++x`, `x--`, `--x` on a number or bigint variable: the old value (postfix) or the new one. */
  increment(
    target: ts.Expression,
    sign: "+" | "-",
    postfix: boolean,
    node: ts.PrefixUnaryExpression | ts.PostfixUnaryExpression,
  ): ValueId {
    const type = this.typeAt(target);
    const one = ONE[type.k];
    const host = this.host.leaves;
    // A `bigint | number` steps the kind it holds.
    const mixed = type.k === "union" && type.ms.every((m) => m.k === "number" || m.k === "bigint");

    if (one === undefined && (!mixed || !host))
      this.unsupported(node, `${sign}${sign} on a ${typeKey(type)}`);

    const place = this.target(target);
    const span = spanOf(node);
    const current = this.coerce(place.read(), type, target);
    const next =
      one === undefined
        ? this.planOf(host!.step(current, type, sign, node), [current], span)
        : this.b.binary(sign, current, this.b.const(one, span), span);

    place.write(this.coerce(next, place.type, node), span);
    return postfix ? current : next;
  }

  /**
   * `c ? a : b`: only the branch the condition picks runs. Its type is the
   * one it becomes, when given (each branch converts to it, as a literal
   * on its own would), but for promises, which an async function awaits
   * before converting; the checker's union of the branches' otherwise.
   * When a platform test picks the branch, the other one, which another
   * platform's SDK types, plays no part.
   */
  conditional(node: ts.ConditionalExpression, hint?: LType): ValueId {
    const guard = this.host.platformGuard?.(node.condition);
    const live =
      guard && guard.runs !== "nowhere" && (guard.runs === "elsewhere" || !guard.rest.length)
        ? guard.runs === "here"
          ? node.whenTrue
          : node.whenFalse
        : undefined;
    const own = this.typeAt(live ?? node);
    const promised =
      own.k === "promise" || (own.k === "union" && own.ms.some((m) => m.k === "promise"));
    const type = hint && !isVoidish(hint) && !promised ? hint : own;

    if (guard?.runs === "nowhere") return this.platformOnly(node, own);

    if (live) return this.coerce(this.expr(live, type), type, live);

    const cond = guard ? this.all(guard.rest) : this.condition(node.condition);
    const branch = (e: ts.Expression) => () =>
      this.b.yield(this.coerce(this.expr(e, type), type, e), spanOf(e));

    return this.b.if(cond, spanOf(node), branch(node.whenTrue), branch(node.whenFalse), type)!;
  }

  /** `a && b && …` as one condition, each tested only when those before it hold. */
  all(conds: readonly ts.Expression[]): ValueId {
    const [first, ...rest] = conds;
    const test = this.condition(first!);

    if (!rest.length) return test;

    const span = spanOf(first!);

    return this.b.if(
      test,
      span,
      () => this.b.yield(this.all(rest), span),
      () => this.b.yield(this.b.const(false, span), span),
      T.boolean,
    )!;
  }

  /** Code for the platforms, in a build for neither: it throws when it runs. */
  platformOnly(node: ts.Node, type: LType): ValueId {
    const host = this.host.leaves;

    if (!host) this.unsupported(node, "code for the platforms only");

    return this.planOf(host.platformOnly(node, type), [], spanOf(node));
  }

  /**
   * A statement of platform code, in a build for neither: it throws, and
   * nothing after it runs. (The analysis, which leaves the platforms'
   * code out of such a build, knows nothing of the throw: it is the
   * backend's plan.)
   */
  nowhere(s: ts.Statement): void {
    this.platformOnly(s, T.void);
    this.b.unreachable(spanOf(s));
  }

  /** `if`: the branch a platform test leaves, or both, as the condition picks. */
  ifStatement(s: ts.IfStatement): void {
    const otherwise = s.elseStatement;
    const guard = this.host.platformGuard?.(s.expression);

    if (guard?.runs === "nowhere") {
      this.nowhere(s);
      return;
    }

    if (guard && (guard.runs === "elsewhere" || !guard.rest.length)) {
      const live = guard.runs === "here" ? s.thenStatement : otherwise;

      if (live) this.b.block(spanOf(s), () => this.nested(live));
      return;
    }

    this.b.if(
      guard ? this.all(guard.rest) : this.condition(s.expression),
      spanOf(s),
      () => this.nested(s.thenStatement),
      () => otherwise && this.nested(otherwise),
    );
  }

  template(node: ts.TemplateExpression): ValueId {
    // A part of a type the compiler cannot represent here is the emitter's to convert.
    const prints = (e: ts.Expression) => {
      let t: LType;

      try {
        t = this.host.typeAt(e);
      } catch {
        return false;
      }

      return t.k === "string" || unaryResult("String", t) !== undefined;
    };

    if (!node.templateSpans.every((s) => prints(s.expression))) return this.leaf(node);

    const parts: ValueId[] = [];
    const text = (s: string, at: ts.Node) => {
      if (s) parts.push(this.b.const(s, spanOf(at)));
    };

    text(node.head.text, node.head);

    for (const span of node.templateSpans) {
      parts.push(this.string(this.expr(span.expression), span.expression));
      text(span.literal.text, span.literal);
    }

    const [first = this.b.const("", spanOf(node)), ...rest] = parts;

    return rest.reduce((acc, p) => this.b.binary("+", acc, p, spanOf(node)), first);
  }
}

/**
 * Whether `to` is what a `from` holds, narrowed: an optional's value or
 * absence, some of a union's members, or an object of a class it derives. Not a value converted to a wider
 * type (a conditional's branches, already converted to the type it becomes).
 */
function narrows(from: LType, to: LType, derives: (sub: LType, base: LType) => boolean): boolean {
  if (sameType(from, to) || (isVoidish(from) && isVoidish(to))) return false;

  if (from.k === "opt")
    return isAbsent(to) || sameType(from.inner, to) || narrows(from.inner, to, derives);

  // `instanceof`: an Error or an interface known to be a class's object, a class one of its subclass's.
  if (to.k === "class" && (from.k === "error" || from.k === "iface")) return true;

  if (to.k === "class" && from.k === "class") return derives(to, from);

  // A platform object of a subclass (`instanceof` on an SDK class): one representation holds both.
  if (to.k === "native" && from.k === "native") return to.platform === from.platform;

  if (from.k !== "union") return false;

  // `instanceof` on a union holding a base class: an object of the class tested.
  if (to.k === "class" && from.ms.some((m) => m.k === "class" && derives(to, m))) return true;

  const held = (m: LType) => from.ms.some((f) => sameType(f, m));

  return to.k === "union" ? to.ms.every(held) : held(to);
}

/** A link of an optional chain: a member access, call or `!` inside one. */
function isChain(node: ts.Expression): boolean {
  const kinds = [
    ts.SyntaxKind.PropertyAccessExpression,
    ts.SyntaxKind.ElementAccessExpression,
    ts.SyntaxKind.CallExpression,
    ts.SyntaxKind.NonNullExpression,
  ];

  return (node.flags & ts.NodeFlags.OptionalChain) !== 0 && kinds.includes(node.kind);
}

/** Declared by the TypeScript library (or another declaration file), not by the program. */
function isLibrary(sym: ts.Symbol): boolean {
  const decls = sym.declarations ?? [];

  return decls.length > 0 && decls.every((d) => d.getSourceFile().isDeclarationFile);
}

/** Whether `body` writes the variable `sym`: assigns it (destructuring too), increments it, loops over it. */
function assignedIn(checker: ts.TypeChecker, body: ts.Node, sym: ts.Symbol): boolean {
  const visit = (n: ts.Node): boolean =>
    (ts.isIdentifier(n) && symbolOf(checker, n) === sym && isWriteTarget(n)) ||
    (ts.forEachChild(n, visit) ?? false);

  return visit(body);
}

function skipParentheses(e: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(e) ? skipParentheses(e.expression) : e;
}

/**
 * Whether a variable one switch clause declares is used in another: the
 * clauses share one scope in JavaScript, but become separate regions here.
 */
function sharesDeclarations(
  checker: ts.TypeChecker,
  clauses: readonly ts.CaseOrDefaultClause[],
): boolean {
  const owner = new Map<ts.Symbol, ts.CaseOrDefaultClause>();

  for (const c of clauses)
    for (const s of c.statements)
      if (ts.isVariableStatement(s))
        for (const d of s.declarationList.declarations) {
          const sym = checker.getSymbolAtLocation(d.name);

          if (sym) owner.set(sym, c);
        }

  const visit = (c: ts.CaseOrDefaultClause, n: ts.Node): boolean => {
    const sym = ts.isIdentifier(n) ? checker.getSymbolAtLocation(n) : undefined;
    const declaredElsewhere = sym !== undefined && owner.has(sym) && owner.get(sym) !== c;

    return declaredElsewhere || (ts.forEachChild(n, (x) => visit(c, x)) ?? false);
  };

  return owner.size > 0 && clauses.some((c) => visit(c, c));
}

/** The labels of a labeled statement, down to the statement they name. */
function unlabeled(s: ts.LabeledStatement): { labels: string[]; statement: ts.Statement } {
  const labels: string[] = [];
  let statement: ts.Statement = s;

  while (ts.isLabeledStatement(statement)) {
    labels.push(statement.label.text);
    statement = statement.statement;
  }
  return { labels, statement };
}

type LabeledLowering = (s: never, labels: readonly string[], lw: Lowerer) => void;

/** Statements the labels on them name as jump targets: loops and switch. */
const LABELED: Partial<Record<ts.SyntaxKind, LabeledLowering>> = {
  [ts.SyntaxKind.WhileStatement]: (s: ts.WhileStatement, labels, lw: Lowerer) =>
    lw.loop(s, labels, { condition: s.expression, testFirst: true }),

  [ts.SyntaxKind.DoStatement]: (s: ts.DoStatement, labels, lw: Lowerer) =>
    lw.loop(s, labels, { condition: s.expression, testFirst: false }),

  [ts.SyntaxKind.ForStatement]: (s: ts.ForStatement, labels, lw: Lowerer) => {
    const init = s.initializer;
    const incrementor = s.incrementor;
    const run = (perIteration: readonly ts.Symbol[] = []) =>
      lw.loop(s, labels, {
        ...(s.condition ? { condition: s.condition } : {}),
        testFirst: true,
        ...(incrementor ? { step: () => void lw.expr(incrementor) } : {}),
        perIteration,
      });

    if (init && ts.isVariableDeclarationList(init)) {
      // The loop's variables are scoped to it; those closures share, and the body does not
      // assign, are copied for each iteration.
      lw.b.block(spanOf(s), () => {
        lw.declarations(init);
        run(lw.iterationVariables(init, s.statement));
      });
      return;
    }

    if (init) lw.expr(init);

    run();
  },

  [ts.SyntaxKind.SwitchStatement]: (s: ts.SwitchStatement, labels, lw: Lowerer) =>
    lw.switch(s, labels),

  [ts.SyntaxKind.ForOfStatement]: (s: ts.ForOfStatement, labels, lw: Lowerer) =>
    lw.forOf(s, labels),

  [ts.SyntaxKind.ForInStatement]: (s: ts.ForInStatement, labels, lw: Lowerer) =>
    lw.forIn(s, labels),
};

type StatementLowering = (s: never, lw: Lowerer) => void;

/** A statement that takes labels, without any. */
const unlabeledForm =
  (kind: ts.SyntaxKind): StatementLowering =>
  (s: never, lw: Lowerer) =>
    LABELED[kind]!(s, [], lw);

const STATEMENTS: Partial<Record<ts.SyntaxKind, StatementLowering>> = {
  [ts.SyntaxKind.EmptyStatement]: () => {},

  [ts.SyntaxKind.TypeAliasDeclaration]: () => {},

  [ts.SyntaxKind.InterfaceDeclaration]: () => {},

  [ts.SyntaxKind.VariableStatement]: (s: ts.VariableStatement, lw: Lowerer) =>
    lw.declarations(s.declarationList),

  [ts.SyntaxKind.ExpressionStatement]: (s: ts.ExpressionStatement, lw) => {
    const e = s.expression;

    if (ts.isYieldExpression(e)) lw.yieldStatement(e);
    else if (ts.isCallExpression(e) && e.expression.kind === ts.SyntaxKind.SuperKeyword)
      lw.superCall(e);
    else lw.expr(ts.isVoidExpression(e) ? e.expression : e);
  },

  [ts.SyntaxKind.ReturnStatement]: (s: ts.ReturnStatement, lw: Lowerer) => {
    if (s.expression) {
      lw.returns(s.expression, spanOf(s));
      return;
    }

    // `return;` from a function that may give undefined gives it.
    if (isVoidish(lw.result)) lw.b.return(undefined, spanOf(s));
    else lw.b.return(lw.coerce(lw.b.const(undefined, spanOf(s)), lw.result, s), spanOf(s));
  },

  [ts.SyntaxKind.FunctionDeclaration]: (s: ts.FunctionDeclaration, lw: Lowerer) =>
    lw.defineDeferred(s),

  [ts.SyntaxKind.ThrowStatement]: (s: ts.ThrowStatement, lw: Lowerer) => {
    const v = lw.expr(s.expression);
    const t = lw.b.typeOf(v);

    // An Error, or an object of a class deriving from it (which keeps its class).
    if (t.k !== "error" && !(t.k === "class" && lw.host.isError?.(t)))
      fail(
        s.expression,
        Codes.UnsupportedThrow,
        "only Error values can be thrown; use `throw new Error(...)`",
      );

    lw.b.throw(v, spanOf(s));
  },

  [ts.SyntaxKind.TryStatement]: (s: ts.TryStatement, lw: Lowerer) => lw.tryStatement(s),

  [ts.SyntaxKind.Block]: (s: ts.Block, lw: Lowerer) =>
    lw.b.block(spanOf(s), () => lw.statements(s.statements)),

  [ts.SyntaxKind.IfStatement]: (s: ts.IfStatement, lw: Lowerer) => lw.ifStatement(s),

  [ts.SyntaxKind.LabeledStatement]: (s: ts.LabeledStatement, lw: Lowerer) => {
    const { labels, statement } = unlabeled(s);
    const takesLabels = LABELED[statement.kind] as
      | ((s: ts.Statement, labels: readonly string[], lw: Lowerer) => void)
      | undefined;

    if (takesLabels) {
      takesLabels(statement, labels, lw);
      return;
    }

    // Any other statement: a block `break label` leaves.
    lw.b.block(
      spanOf(s),
      (target) => lw.within({ target: target!, kind: "block", labels }, () => lw.nested(statement)),
      true,
    );
  },

  [ts.SyntaxKind.WhileStatement]: unlabeledForm(ts.SyntaxKind.WhileStatement),

  [ts.SyntaxKind.DoStatement]: unlabeledForm(ts.SyntaxKind.DoStatement),

  [ts.SyntaxKind.ForStatement]: unlabeledForm(ts.SyntaxKind.ForStatement),

  [ts.SyntaxKind.SwitchStatement]: unlabeledForm(ts.SyntaxKind.SwitchStatement),

  [ts.SyntaxKind.ForOfStatement]: unlabeledForm(ts.SyntaxKind.ForOfStatement),

  [ts.SyntaxKind.ForInStatement]: unlabeledForm(ts.SyntaxKind.ForInStatement),

  [ts.SyntaxKind.BreakStatement]: (s: ts.BreakStatement, lw: Lowerer) =>
    lw.b.break(lw.jumpTarget(s), spanOf(s)),

  [ts.SyntaxKind.ContinueStatement]: (s: ts.ContinueStatement, lw: Lowerer) =>
    lw.b.continue(lw.jumpTarget(s), spanOf(s)),
};

/** The step of `++` and `--` by the type they change. */
const ONE: Partial<Record<LType["k"], number | bigint>> = { number: 1, bigint: 1n };

/** Unary plus of a number: the number; of anything else, a plan (ToNumber). */
function plus(n: ts.PrefixUnaryExpression, lw: Lowerer): ValueId {
  return lw.typeAt(n.operand).k === "number" ? lw.expr(n.operand) : lw.leaf(n);
}

/** `op` on a number or bigint; on anything else, a plan. */
const numericUnary =
  (op: "-" | "~"): PrefixLowering =>
  (n, lw) => {
    const k = lw.typeAt(n.operand).k;

    if (k !== "number" && k !== "bigint") return lw.leaf(n);

    return lw.b.unary(op, lw.expr(n.operand), spanOf(n));
  };

type PrefixLowering = (n: ts.PrefixUnaryExpression, lw: Lowerer) => ValueId;

const PREFIX: Partial<Record<ts.PrefixUnaryOperator, PrefixLowering>> = {
  [ts.SyntaxKind.PlusToken]: plus,

  [ts.SyntaxKind.MinusToken]: numericUnary("-"),

  [ts.SyntaxKind.TildeToken]: numericUnary("~"),

  [ts.SyntaxKind.ExclamationToken]: (n, lw) => lw.b.unary("!", lw.condition(n.operand), spanOf(n)),

  [ts.SyntaxKind.PlusPlusToken]: (n, lw) => lw.increment(n.operand, "+", false, n),

  [ts.SyntaxKind.MinusMinusToken]: (n, lw) => lw.increment(n.operand, "-", false, n),
};

type ExpressionLowering = (n: never, lw: Lowerer) => ValueId;

/** The values of literals, as constants. */
const LITERALS: Partial<Record<ts.SyntaxKind, (n: never) => Constant>> = {
  [ts.SyntaxKind.NumericLiteral]: (n: ts.NumericLiteral) => Number(n.text.replace(/_/g, "")),
  [ts.SyntaxKind.BigIntLiteral]: (n: ts.BigIntLiteral) => bigintLiteralValue(n.text),
  [ts.SyntaxKind.StringLiteral]: (n: ts.StringLiteral) => n.text,
  [ts.SyntaxKind.NoSubstitutionTemplateLiteral]: (n: ts.NoSubstitutionTemplateLiteral) => n.text,
  [ts.SyntaxKind.TrueKeyword]: () => true,
  [ts.SyntaxKind.FalseKeyword]: () => false,
};

/** A literal's value; a literal constant's may be negated (`-1`, `-2n`). */
function literalValue(n: ts.Expression): Constant {
  if (ts.isPrefixUnaryExpression(n)) {
    const v = literalValue(n.operand);

    return typeof v === "bigint" ? -v : -Number(v);
  }

  return LITERALS[n.kind]!(n as never);
}

function literal(n: ts.Expression, lw: Lowerer): ValueId {
  return lw.b.const(literalValue(n), spanOf(n));
}

const EXPRESSIONS: Partial<Record<ts.SyntaxKind, ExpressionLowering>> = {
  [ts.SyntaxKind.NumericLiteral]: literal,

  [ts.SyntaxKind.BigIntLiteral]: literal,

  [ts.SyntaxKind.StringLiteral]: literal,

  [ts.SyntaxKind.NoSubstitutionTemplateLiteral]: literal,

  [ts.SyntaxKind.TrueKeyword]: literal,

  [ts.SyntaxKind.FalseKeyword]: literal,

  [ts.SyntaxKind.NullKeyword]: (n: ts.Expression, lw) => lw.b.const(null, spanOf(n)),

  [ts.SyntaxKind.Identifier]: (n: ts.Identifier, lw) => lw.identifier(n),

  [ts.SyntaxKind.ParenthesizedExpression]: (n: ts.ParenthesizedExpression, lw) =>
    lw.expr(n.expression),

  [ts.SyntaxKind.AsExpression]: (n: ts.AsExpression, lw) => lw.asserted(n),

  [ts.SyntaxKind.TypeAssertionExpression]: (n: ts.TypeAssertion, lw) => lw.asserted(n),

  [ts.SyntaxKind.SatisfiesExpression]: (n: ts.SatisfiesExpression, lw) => lw.expr(n.expression),

  // `x!`: what the optional holds, checked (an absent one throws a TypeError).
  [ts.SyntaxKind.NonNullExpression]: (n: ts.NonNullExpression, lw: Lowerer) => {
    const v = lw.expr(n.expression);
    const t = lw.b.typeOf(v);

    return t.k === "opt" ? lw.b.convert(v, t.inner, spanOf(n)) : v;
  },

  [ts.SyntaxKind.PrefixUnaryExpression]: (n: ts.PrefixUnaryExpression, lw: Lowerer) => {
    const lower = PREFIX[n.operator];

    if (!lower) return lw.leaf(n);

    return lower(n, lw);
  },

  [ts.SyntaxKind.PostfixUnaryExpression]: (n: ts.PostfixUnaryExpression, lw: Lowerer) =>
    lw.increment(n.operand, n.operator === ts.SyntaxKind.PlusPlusToken ? "+" : "-", true, n),

  [ts.SyntaxKind.TypeOfExpression]: (n: ts.TypeOfExpression, lw: Lowerer) =>
    lw.b.unary("typeof", lw.expr(n.expression), spanOf(n)),

  [ts.SyntaxKind.BinaryExpression]: (n: ts.BinaryExpression, lw) => lw.binary(n),

  [ts.SyntaxKind.ConditionalExpression]: (n: ts.ConditionalExpression, lw, hint?: LType) =>
    lw.conditional(n, hint),

  [ts.SyntaxKind.TemplateExpression]: (n: ts.TemplateExpression, lw) => lw.template(n),

  [ts.SyntaxKind.CallExpression]: (n: ts.CallExpression, lw, hint?: LType) => lw.call(n, hint),

  [ts.SyntaxKind.ArrowFunction]: (n: ts.ArrowFunction, lw, hint?: LType) => lw.closure(n, hint),

  [ts.SyntaxKind.AwaitExpression]: (n: ts.AwaitExpression, lw) =>
    lw.awaited(lw.expr(n.expression), n),

  [ts.SyntaxKind.FunctionExpression]: (n: ts.FunctionExpression, lw, hint?: LType) =>
    lw.closure(n, hint),

  [ts.SyntaxKind.NewExpression]: (n: ts.NewExpression, lw) => lw.newExpr(n),
};

/** Binary forms that are not an operator on two values: assignment, comma, logic. */
const BINARY_FORMS: Partial<
  Record<ts.SyntaxKind, (n: ts.BinaryExpression, lw: Lowerer) => ValueId>
> = {
  // The value of `x = v` is `v`, as it was before becoming the variable's type.
  [ts.SyntaxKind.EqualsToken]: (n, lw) => {
    const left = skipParentheses(n.left);

    // Destructuring: the value, then each target in order; the assignment gives the value.
    if (ts.isArrayLiteralExpression(left) || ts.isObjectLiteralExpression(left)) {
      const value = lw.expr(n.right);

      lw.assignPattern(left, value);
      return value;
    }

    const target = lw.target(n.left);
    const value = lw.expr(n.right, target.type);

    target.write(lw.coerce(value, target.type, n.right), spanOf(n));
    return value;
  },

  [ts.SyntaxKind.CommaToken]: (n, lw) => {
    lw.expr(n.left);
    return lw.expr(n.right);
  },

  [ts.SyntaxKind.AmpersandAmpersandToken]: (n, lw) => lw.logical(n, "&&"),

  [ts.SyntaxKind.BarBarToken]: (n, lw) => lw.logical(n, "||"),

  [ts.SyntaxKind.QuestionQuestionToken]: (n, lw) => lw.logical(n, "??"),

  [ts.SyntaxKind.AmpersandAmpersandEqualsToken]: (n, lw) => lw.logicalAssign(n, "&&"),

  [ts.SyntaxKind.BarBarEqualsToken]: (n, lw) => lw.logicalAssign(n, "||"),

  [ts.SyntaxKind.QuestionQuestionEqualsToken]: (n, lw) => lw.logicalAssign(n, "??"),
};

const BINARY: Partial<Record<ts.SyntaxKind, BinaryOp>> = {
  [ts.SyntaxKind.PlusToken]: "+",
  [ts.SyntaxKind.MinusToken]: "-",
  [ts.SyntaxKind.AsteriskToken]: "*",
  [ts.SyntaxKind.SlashToken]: "/",
  [ts.SyntaxKind.PercentToken]: "%",
  [ts.SyntaxKind.AsteriskAsteriskToken]: "**",
  [ts.SyntaxKind.AmpersandToken]: "&",
  [ts.SyntaxKind.BarToken]: "|",
  [ts.SyntaxKind.CaretToken]: "^",
  [ts.SyntaxKind.LessThanLessThanToken]: "<<",
  [ts.SyntaxKind.GreaterThanGreaterThanToken]: ">>",
  [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken]: ">>>",
  [ts.SyntaxKind.LessThanToken]: "<",
  [ts.SyntaxKind.GreaterThanToken]: ">",
  [ts.SyntaxKind.LessThanEqualsToken]: "<=",
  [ts.SyntaxKind.GreaterThanEqualsToken]: ">=",
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: "===",
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: "!==",
  [ts.SyntaxKind.EqualsEqualsToken]: "==",
  [ts.SyntaxKind.ExclamationEqualsToken]: "!=",
};

const COMPOUND: Partial<Record<ts.SyntaxKind, BinaryOp>> = {
  [ts.SyntaxKind.PlusEqualsToken]: "+",
  [ts.SyntaxKind.MinusEqualsToken]: "-",
  [ts.SyntaxKind.AsteriskEqualsToken]: "*",
  [ts.SyntaxKind.SlashEqualsToken]: "/",
  [ts.SyntaxKind.PercentEqualsToken]: "%",
  [ts.SyntaxKind.AsteriskAsteriskEqualsToken]: "**",
  [ts.SyntaxKind.AmpersandEqualsToken]: "&",
  [ts.SyntaxKind.BarEqualsToken]: "|",
  [ts.SyntaxKind.CaretEqualsToken]: "^",
  [ts.SyntaxKind.LessThanLessThanEqualsToken]: "<<",
  [ts.SyntaxKind.GreaterThanGreaterThanEqualsToken]: ">>",
  [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken]: ">>>",
};

function spanOf(node: ts.Node): SourceSpan {
  const sf = node.getSourceFile();
  const start = node.getStart(sf);
  const { line, character } = sf.getLineAndCharacterOfPosition(start);

  return { file: sf.fileName, start, end: node.getEnd(), line: line + 1, column: character + 1 };
}
