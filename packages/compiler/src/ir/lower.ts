/**
 * TypeScript → IR for the subset the IR covers so far: literals (bigints
 * too), arithmetic, bitwise and comparison operators, string concatenation and
 * templates, locals, parameters and module variables (assigned, compound
 * assigned, incremented), calls of the module's functions, `new Error(…)`,
 * conditional and logical expressions, `typeof`, `!`, narrowing of
 * optionals and unions where the checker narrows, blocks, `if`, `while`,
 * `do`, `for`, `switch`, labels, `break`, `continue`, `return` and
 * `throw`. Anything else throws IrUnsupported, and the legacy emitter
 * lowers the function instead (or, under `ir-strict`, compilation stops).
 *
 * Every subexpression becomes operations appended in JavaScript's
 * evaluation order, left to right, so the order is fixed here once; a
 * right side that may not run (`&&`, `||`, `??`, `?:`) goes in a branch.
 */
import ts from "typescript";
import { bigintLiteralValue } from "../lowering/literals.ts";
import { isVoidish, type LType, sameType, T, typeKey } from "../types.ts";
import { IrBuilder } from "./build.ts";
import {
  binaryResult,
  isAbsent,
  type BinaryOp,
  type BuiltinName,
  completes,
  type Constant,
  convertible,
  type EffectSummary,
  type FunctionId,
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

  constructor(node: ts.Node, what: string) {
    const sf = node.getSourceFile();
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    super(`the IR does not lower ${what} yet (${sf.fileName}:${line + 1}:${character + 1})`);
    this.name = "IrUnsupported";
    this.node = node;
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
  /** Whether the platform being built runs `s`, by the platform branches and guard clauses around it. */
  runsHere?(s: ts.Statement): boolean;
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
}

/** The subexpressions of a leaf, lowered before it in evaluation order. */
export interface LeafOperands {
  /** The value of `node`, a subexpression of the leaf (the same value when asked again). */
  operand(node: ts.Expression): ValueId;
  typeOf(v: ValueId): LType;
  /** Whether `symbol` names a local or a parameter of the function. */
  isLocal(symbol: ts.Symbol): boolean;
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
  /** What `node`, code for the platforms, gives in a build for neither: a `type` that throws. */
  platformOnly(node: ts.Node, type: LType): Leaf;
}

/** A place a leaf names: reading it, and writing a value (an operand after the place's own). */
export interface LeafPlace {
  type: LType;
  get: Leaf;
  set(value: ValueId): Leaf;
}

/** What an assignment assigns to: a variable, or a place a leaf names. */
interface Target {
  type: LType;
  read(): ValueId;
  write(value: ValueId, source: SourceSpan): void;
}

/** The function to lower, with the types the compiler gave its signature. */
export interface LowerInput {
  decl: ts.FunctionDeclaration;
  id: FunctionId;
  params: LType[];
  result: LType;
  async: boolean;
  generic: boolean;
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

  constructor(input: LowerInput, host: LowerHost) {
    this.input = input;
    this.host = host;
    this.result = input.result;
    this.b = new IrBuilder(input.id, input.result, spanOf(input.decl), input.async);
  }

  function(): Lowered {
    const d = this.input.decl;

    if (this.input.async) this.unsupported(d, "async functions");

    if (d.asteriskToken) this.unsupported(d, "generators");

    if (this.input.generic) this.unsupported(d, "generic functions");

    if (!d.body) this.unsupported(d, "functions without a body");

    const body = d.body;
    const values = d.parameters.map((p, i) => {
      if (!ts.isIdentifier(p.name) || p.initializer || p.questionToken || p.dotDotDotToken)
        this.unsupported(p, "optional, rest, defaulted or destructured parameters");

      return this.b.param(i, this.input.params[i]!, spanOf(p));
    });

    // A parameter the body assigns is a local, starting as the argument.
    d.parameters.forEach((p, i) => {
      const sym = this.symbol(p.name as ts.Identifier);

      if (!assignedIn(this.host.checker, body, sym)) {
        this.params.set(sym, values[i]!);
        return;
      }

      const place = this.declareLocal(sym, p.name.getText(), this.input.params[i]!, p);

      this.b.store(place, values[i]!, spanOf(p));
    });

    this.statements(body.statements);

    const fn = this.b.finish(this.input.effects);

    // TypeScript knows every path returns; a body the IR cannot prove it for is left to the legacy emitter.
    if (!isVoidish(this.result) && completes(fn, fn.body))
      this.unsupported(d, "a body that can end without returning a value");

    return { fn, signatures: this.signatures, effects: this.effects };
  }

  unsupported(node: ts.Node, what: string): never {
    throw new IrUnsupported(node, what);
  }

  symbol(id: ts.Identifier): ts.Symbol {
    const sym = this.host.checker.getSymbolAtLocation(id);

    if (!sym) this.unsupported(id, `the unresolved name ${id.text}`);

    return sym;
  }

  /** The type at `node`; one the compiler cannot represent is left to the legacy emitter to report. */
  typeAt(node: ts.Node): LType {
    try {
      return this.host.typeAt(node);
    } catch {
      this.unsupported(node, "this type");
    }
  }

  /** A variable's declared type; one the compiler cannot represent is left to the legacy emitter. */
  declaredType(sym: ts.Symbol, at: ts.Node): LType {
    try {
      return this.host.typeOf(sym, at);
    } catch {
      this.unsupported(at, "this type");
    }
  }

  statement(s: ts.Statement): void {
    if (this.host.runsHere?.(s) === false) return;

    const lower = STATEMENTS[s.kind] as ((s: ts.Statement, lw: Lowerer) => void) | undefined;

    if (!lower) this.unsupported(s, `${ts.SyntaxKind[s.kind]} statements`);

    lower(s, this);
  }

  /** Statements in order, up to one that leaves: what follows it never runs. */
  statements(list: readonly ts.Statement[]): void {
    for (const s of list) {
      if (this.b.ended) return;

      this.statement(s);
    }
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

  /** A loop over `node`'s body, leaving when `condition` (tested first, or last) is false. */
  loop(
    node: ts.IterationStatement,
    labels: readonly string[],
    parts: { condition?: ts.Expression; testFirst: boolean; step?: () => void },
  ): void {
    const { condition, testFirst, step } = parts;
    const body = (loop: TargetId) =>
      this.within({ target: loop, kind: "loop", labels }, () => {
        if (condition && testFirst) this.exitUnless(condition, loop);

        this.nested(node.statement);
      });
    const next =
      step ??
      (condition && !testFirst ? (loop: TargetId) => this.exitUnless(condition, loop) : undefined);

    this.b.loop(spanOf(node), body, next);
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

  /** `let`/`const` declarations, each initializer run before its variable exists. */
  declarations(list: ts.VariableDeclarationList): void {
    const scoped = list.flags & ts.NodeFlags.BlockScoped;

    if (scoped !== ts.NodeFlags.Let && scoped !== ts.NodeFlags.Const)
      this.unsupported(list, "declarations other than let and const");

    for (const d of list.declarations) {
      if (!ts.isIdentifier(d.name)) this.unsupported(d, "destructuring");

      const sym = this.symbol(d.name);
      const declared = this.declaredType(sym, d.name);
      const type = declared.k === "never" ? T.undefined : declared;
      const value =
        d.initializer && this.coerce(this.expr(d.initializer, type), type, d.initializer);
      const place = this.declareLocal(sym, d.name.text, type, d);

      if (value !== undefined) this.b.store(place, value, spanOf(d));
    }
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
            const test = this.operator("===", d, this.expr(next.c.expression), next.c);

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
    const lower = EXPRESSIONS[node.kind] as
      | ((n: ts.Expression, lw: Lowerer, hint?: LType) => ValueId)
      | undefined;
    const v = lower ? lower(node, this, hint) : this.leaf(node, hint);

    // A leaf's type is the backend's: narrowed where the checker narrows, a literal's as its hint shapes it.
    if (this.planned.has(v)) return v;

    const [given, checked] = [this.b.typeOf(v), this.typeAt(node)];

    // The checker narrowed the value here (an optional known present, a union's member).
    return narrows(given, checked) ? this.coerce(v, checked, node) : v;
  }

  /**
   * `node` as a plan of the backend's, after the subexpressions it takes,
   * each lowered once, in evaluation order (the order of the source).
   * Optional chains short-circuit, which a plan's operands cannot.
   */
  leaf(node: ts.Expression, hint?: LType): ValueId {
    const host = this.host.leaves;

    if (!host) this.unsupported(node, `${ts.SyntaxKind[node.kind]} expressions`);

    if (node.flags & ts.NodeFlags.OptionalChain) this.unsupported(node, "optional chains");

    const { operands, args } = this.operands();

    return this.planOf(host.plan(node, operands, hint), args, spanOf(node));
  }

  /** The operands a leaf asks for, each lowered once, in the order of the source. */
  operands(): { operands: LeafOperands; args: ValueId[] } {
    const args: ValueId[] = [];
    const lowered = new Map<ts.Node, ValueId>();
    let end = -1;
    const operands: LeafOperands = {
      operand: (n) => {
        const known = lowered.get(n);

        if (known !== undefined) return known;

        if (n.getStart() < end) this.unsupported(n, "operands a plan takes out of order");

        const v = this.expr(n);

        lowered.set(n, v);
        args.push(v);
        end = n.getEnd();
        return v;
      },
      typeOf: (v) => this.b.typeOf(v),
      isLocal: (sym) => this.locals.has(sym) || this.params.has(sym),
    };

    return { operands, args };
  }

  /** The plan `leaf` on `args`; one that gives nothing gives undefined, once it ran. */
  planOf(leaf: Leaf, args: ValueId[], span: SourceSpan): ValueId {
    const result = isVoidish(leaf.type) ? undefined : leaf.type;
    const v =
      this.b.plan(leaf.name, leaf.code, args, result, span) ?? this.b.const(undefined, span);

    this.planned.add(v);
    return v;
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

  /** Whether `target` is a variable the IR stores into: a local or a module variable. */
  variable(target: ts.Expression): boolean {
    const id = skipParentheses(target);
    const sym = ts.isIdentifier(id) ? this.host.checker.getSymbolAtLocation(id) : undefined;

    return sym !== undefined && (this.locals.has(sym) || this.host.global(sym)?.kind === "var");
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
    const local = this.locals.get(sym);

    if (local !== undefined) return { place: local, type: this.localTypes.get(local)! };

    const g = this.host.global(sym);

    if (g?.kind !== "var") this.unsupported(id, `the name ${id.text}`);

    return { place: this.b.modulePlace(g.id, g.name, g.type, g.mutable), type: g.type };
  }

  declareLocal(sym: ts.Symbol, name: string, type: LType, node: ts.Node): PlaceId {
    const place = this.b.local(name, type, spanOf(node));

    this.locals.set(sym, place);
    this.localTypes.set(place, type);
    return place;
  }

  identifier(id: ts.Identifier): ValueId {
    const sym = this.host.checker.getSymbolAtLocation(id);
    const param = sym && this.params.get(sym);

    if (param !== undefined) return param;

    // `undefined` has a symbol without declarations; NaN and Infinity are the library's.
    const constant =
      Object.hasOwn(LIBRARY_CONSTANTS, id.text) &&
      (!sym || !sym.declarations?.length || isLibrary(sym));

    if (!sym || constant) {
      if (!constant) return this.leaf(id);

      return this.b.const(LIBRARY_CONSTANTS[id.text], spanOf(id));
    }

    const g = this.locals.has(sym) ? undefined : this.host.global(sym);

    // A function as a value, a platform's or the SDK's constant…
    if (!this.locals.has(sym) && g?.kind !== "var") return this.leaf(id);

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

    if (!direct) return this.leaf(node, hint);

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
    return v ?? this.b.const(undefined, spanOf(node));
  }

  /** `new Error(message)` and its kinds; any other construction is a plan. */
  newExpr(node: ts.NewExpression): ValueId {
    const callee = node.expression;
    const builtin = ts.isIdentifier(callee) ? ERRORS[callee.text] : undefined;
    const args = node.arguments ?? [];
    const sym = ts.isIdentifier(callee) ? this.host.checker.getSymbolAtLocation(callee) : undefined;
    const message = args[0] && this.typeAt(args[0]);

    if (
      !builtin ||
      !sym ||
      !isLibrary(sym) ||
      args.length > 1 ||
      (message && message.k !== "string")
    )
      return this.leaf(node);

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

    if (one === undefined) this.unsupported(node, `${sign}${sign} on a ${typeKey(type)}`);

    const place = this.target(target);
    const span = spanOf(node);
    const current = this.coerce(place.read(), type, target);
    const next = this.b.binary(sign, current, this.b.const(one, span), span);

    place.write(this.coerce(next, place.type, node), span);
    return postfix ? current : next;
  }

  /**
   * `c ? a : b`: only the branch the condition picks runs. Its type is the
   * one it becomes, when given (each branch converts to it, as a literal
   * on its own would), but for promises, which an async function awaits
   * before converting; the checker's union of the branches' otherwise.
   */
  conditional(node: ts.ConditionalExpression, hint?: LType): ValueId {
    const own = this.typeAt(node);
    const promised =
      own.k === "promise" || (own.k === "union" && own.ms.some((m) => m.k === "promise"));
    const type = hint && !isVoidish(hint) && !promised ? hint : own;
    const guard = this.host.platformGuard?.(node.condition);

    if (guard?.runs === "nowhere") return this.platformOnly(node, own);

    if (guard && (guard.runs === "elsewhere" || !guard.rest.length)) {
      const live = guard.runs === "here" ? node.whenTrue : node.whenFalse;

      return this.coerce(this.expr(live, type), type, live);
    }

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

  /** A statement of platform code, in a build for neither: it throws, and nothing after it runs. */
  nowhere(s: ts.Statement): void {
    this.b.throw(this.platformOnly(s, T.error), spanOf(s));
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
    const prints = (e: ts.Expression) => {
      const t = this.typeAt(e);

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
 * absence, or some of a union's members. Not a value converted to a wider
 * type (a conditional's branches, already converted to the type it becomes).
 */
function narrows(from: LType, to: LType): boolean {
  if (sameType(from, to) || (isVoidish(from) && isVoidish(to))) return false;

  if (from.k === "opt") return isAbsent(to) || sameType(from.inner, to) || narrows(from.inner, to);

  if (from.k !== "union") return false;

  const held = (m: LType) => from.ms.some((f) => sameType(f, m));

  return to.k === "union" ? to.ms.every(held) : held(to);
}

/** Declared by the TypeScript library (or another declaration file), not by the program. */
function isLibrary(sym: ts.Symbol): boolean {
  const decls = sym.declarations ?? [];

  return decls.length > 0 && decls.every((d) => d.getSourceFile().isDeclarationFile);
}

/** Whether `body` assigns (or increments) the variable `sym`. */
function assignedIn(checker: ts.TypeChecker, body: ts.Node, sym: ts.Symbol): boolean {
  const names = (target: ts.Expression): boolean => {
    const t = skipParentheses(target);

    return ts.isIdentifier(t) && checker.getSymbolAtLocation(t) === sym;
  };
  const visit = (n: ts.Node): boolean => {
    const assignment =
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      n.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      names(n.left);
    const step =
      (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
      (n.operator === ts.SyntaxKind.PlusPlusToken ||
        n.operator === ts.SyntaxKind.MinusMinusToken) &&
      names(n.operand);

    return assignment || step || (ts.forEachChild(n, visit) ?? false);
  };

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
    const run = () =>
      lw.loop(s, labels, {
        ...(s.condition ? { condition: s.condition } : {}),
        testFirst: true,
        ...(incrementor ? { step: () => void lw.expr(incrementor) } : {}),
      });

    if (init && ts.isVariableDeclarationList(init)) {
      // The loop's variables are scoped to it.
      lw.b.block(spanOf(s), () => {
        lw.declarations(init);
        run();
      });
      return;
    }

    if (init) lw.expr(init);

    run();
  },

  [ts.SyntaxKind.SwitchStatement]: (s: ts.SwitchStatement, labels, lw: Lowerer) =>
    lw.switch(s, labels),
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
    lw.expr(ts.isVoidExpression(s.expression) ? s.expression.expression : s.expression);
  },

  [ts.SyntaxKind.ReturnStatement]: (s: ts.ReturnStatement, lw: Lowerer) => {
    const result = lw.result;

    if (!s.expression) {
      if (!isVoidish(result)) lw.unsupported(s, "`return;` from a function giving a value");

      lw.b.return(undefined, spanOf(s));
      return;
    }

    const v = lw.expr(s.expression, isVoidish(result) ? undefined : result);

    if (isVoidish(result)) {
      if (!isVoidish(lw.b.typeOf(v))) lw.unsupported(s, "returning a value from a void function");

      lw.b.return(undefined, spanOf(s));
      return;
    }

    lw.b.return(lw.coerce(v, result, s.expression), spanOf(s));
  },

  [ts.SyntaxKind.ThrowStatement]: (s: ts.ThrowStatement, lw: Lowerer) => {
    const v = lw.expr(s.expression);

    if (lw.b.typeOf(v).k !== "error") lw.unsupported(s, "throwing anything but an Error");

    lw.b.throw(v, spanOf(s));
  },

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

  [ts.SyntaxKind.AsExpression]: (n: ts.AsExpression, lw) => lw.expr(n.expression),

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

  [ts.SyntaxKind.NewExpression]: (n: ts.NewExpression, lw) => lw.newExpr(n),
};

/** Binary forms that are not an operator on two values: assignment, comma, logic. */
const BINARY_FORMS: Partial<
  Record<ts.SyntaxKind, (n: ts.BinaryExpression, lw: Lowerer) => ValueId>
> = {
  // The value of `x = v` is `v`, as it was before becoming the variable's type.
  [ts.SyntaxKind.EqualsToken]: (n, lw) => {
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
