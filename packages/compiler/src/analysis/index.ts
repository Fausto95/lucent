/**
 * Program analyses over the checked program: transitive effect summaries,
 * captures and escapes, and the execution contexts (owners) that may run
 * each function. Computed once per program (per target), deterministic,
 * and conservative: what the compiler cannot see stays unknown.
 *
 * Consumers query `ProgramFacts`: the IR takes its effect records; APIs
 * that move work to another context check a function (`check`), what it
 * captures (`checkCaptures`) and the values it is given (`transfer`); APIs
 * that lend a value for a scope check it does not outlive it (`escapes`).
 */
import ts from "typescript";
import type { EffectSummary, OwnerId } from "../ir/ir.ts";
import type { LucentProgram } from "../program.ts";
import type { Platform } from "../sdk/schema.ts";
import {
  type Cause,
  code,
  describe,
  effectSummary,
  type Step,
  stepsOf,
  type Summary,
} from "./facts.ts";
import { FlowGraph, type Program } from "./local.ts";
import { EXTENSION_NATIVE } from "../extensions/facts.ts";
import { NO_NATIVE, type NativeFactsSource, nativeSources, SDK_NATIVE } from "./native.ts";
import {
  type Capture,
  capturesOf,
  checkCaptures,
  checkUnit,
  type Context,
  ownersOf,
  type TransferProblem,
  transferProblem,
  type Violation,
} from "./ownership.ts";
import { type Escape, solve, type Solved } from "./solve.ts";
import { type AnalysedModule, findUnits, type Unit } from "./units.ts";

export type { Cause, Step, Summary } from "./facts.ts";
export { describe, stepsOf } from "./facts.ts";
export type { NativeCallback, NativeClass, NativeFactsSource, NativeUse } from "./native.ts";
export type { Capture, Context, Rule, TransferProblem, Violation } from "./ownership.ts";
export type { EscapeKind } from "./local.ts";
export type { AnalysedModule, ModuleVar, Unit, UnitKind } from "./units.ts";
export { literalConstant } from "./units.ts";

export interface AnalysisInput {
  readonly checker: ts.TypeChecker;
  readonly modules: readonly AnalysedModule[];
  /** The target: platform code of other platforms is left out. None: the host. */
  readonly platform?: Platform;
  /** Native facts; none: every native declaration is unknown. */
  readonly native?: NativeFactsSource;
  /**
   * Calls that hand their arguments on and run none of the program's code
   * while they run: a view's event prop posts them to JavaScript, `expose`
   * keeps a view's commands. None: every call runs its callee.
   */
  readonly posts?: (call: ts.CallExpression) => boolean;
}

/** How a value escapes: the kind, and the path that lets it go. */
export interface ValueEscape {
  readonly kind: Escape["kind"];
  /** "`bytes` is assigned to `b` (m.lucent.ts:3:9), which is returned (m.lucent.ts:4:3)". */
  readonly message: string;
  readonly cause: Cause;
  readonly steps: readonly Step[];
}

export interface ProgramFacts {
  /** Every unit, in source order (modules in the program's order). */
  readonly units: readonly Unit[];
  /** The unit a function, method, class (its construction) or source file (its initialization) is. */
  unit(node: ts.Node): Unit | undefined;
  byId(id: string): Unit | undefined;
  summary(unit: Unit): Summary;
  /** The IR's effect record for a unit. */
  effects(unit: Unit): EffectSummary;
  /** The contexts that may run a unit, each with why. */
  owners(unit: Unit): ReadonlyMap<OwnerId, Cause>;
  /** Why a unit (and all it runs) cannot run on `context`; empty when it can. */
  check(unit: Unit, context: Context): Violation[];
  /** The variables a closure captures. */
  captures(unit: Unit): Capture[];
  /** Why what a closure captures cannot go with it to `context`. */
  checkCaptures(unit: Unit, context: Context): Violation[];
  /** Why a value of `type`, named `name`, cannot be handed to another context. */
  transfer(type: ts.Type, name: string): TransferProblem | undefined;
  /**
   * How the value of a variable (a parameter, a local) can outlive the code
   * of the unit declaring it: returned, stored, captured by a closure that
   * escapes, passed to code that keeps it, used after `await`.
   */
  escapes(symbol: ts.Symbol): ValueEscape[];
  /** A readable listing of every unit's facts, for tests and debugging. */
  dump(): string;
}

/** Analyses a program's units. */
export function analyze(input: AnalysisInput): ProgramFacts {
  return new Facts(input);
}

const cache = new WeakMap<ts.Program, ProgramFacts>();

/** The facts of a Lucent program, with the SDKs' native facts: computed once per program. */
export function programFacts(lp: LucentProgram): ProgramFacts {
  let facts = cache.get(lp.program);

  if (!facts) {
    facts = analyze({
      checker: lp.checker,
      modules: lp.modules,
      ...(lp.platform ? { platform: lp.platform } : {}),
      // Native extensions are C, built for every target, the host included.
      native: nativeSources(EXTENSION_NATIVE, lp.platform ? SDK_NATIVE : NO_NATIVE),
    });
    cache.set(lp.program, facts);
  }

  return facts;
}

class Facts implements ProgramFacts {
  readonly units: readonly Unit[];
  private readonly solved: Solved;
  private readonly checker: ts.TypeChecker;
  private readonly native: NativeFactsSource;
  private readonly ids: ReadonlyMap<string, Unit>;
  private owned?: Map<Unit, Map<OwnerId, Cause>>;

  constructor(input: AnalysisInput) {
    const checker = input.checker;
    const units = findUnits(checker, input.modules, input.platform);
    const p: Program = {
      checker,
      units,
      native: input.native ?? NO_NATIVE,
      platform: input.platform,
      graph: new FlowGraph(),
      posts: input.posts ?? (() => false),
      resolve: (s) => (s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s),
    };

    this.checker = checker;
    this.native = p.native;
    this.units = units.list;
    this.ids = new Map(units.list.map((u) => [u.id, u]));
    this.solved = solve(p);
  }

  unit(node: ts.Node): Unit | undefined {
    return this.solved.p.units.byNode.get(node);
  }

  byId(id: string): Unit | undefined {
    return this.ids.get(id);
  }

  summary(unit: Unit): Summary {
    const s = this.solved.summaries.get(unit);
    if (!s) throw new Error(`${unit.id} is not a unit of this program`);

    return s;
  }

  effects(unit: Unit): EffectSummary {
    return effectSummary(this.summary(unit), unit);
  }

  owners(unit: Unit): ReadonlyMap<OwnerId, Cause> {
    this.owned ??= ownersOf(this.solved);
    return this.owned.get(unit) ?? new Map();
  }

  check(unit: Unit, context: Context): Violation[] {
    return checkUnit(this.summary(unit), unit, context);
  }

  captures(unit: Unit): Capture[] {
    return capturesOf(this.solved, unit);
  }

  checkCaptures(unit: Unit, context: Context): Violation[] {
    return checkCaptures(this.solved, (u) => this.check(u, context), unit, context);
  }

  transfer(type: ts.Type, name: string): TransferProblem | undefined {
    return transferProblem(this.checker, this.native, type, name);
  }

  escapes(symbol: ts.Symbol): ValueEscape[] {
    const graph = this.solved.p.graph;
    const root = graph.declaredIn.get(symbol) ?? graph.params.get(symbol)?.unit;
    if (!root) return [];

    return this.solved.escapesOf(symbol, root, true).map((e) => ({
      kind: e.kind,
      message: `${code(symbol.name)} ${describe(e.cause)}`,
      cause: e.cause,
      steps: stepsOf(e.cause),
    }));
  }

  dump(): string {
    return this.units.map((u) => this.dumpUnit(u)).join("\n");
  }

  private dumpUnit(u: Unit): string {
    const s = this.summary(u);
    const fields = Object.entries(this.effects(u)).map(([k, v]) => `${k}=${String(v)}`);
    const lines = [`${u.id} (${u.kind}${u.exported ? ", exported" : ""})`, `  ${fields.join(" ")}`];
    const list = (
      label: string,
      entries: Iterable<[unknown, Cause]>,
      name: (key: unknown) => string = String,
    ) => {
      for (const [key, c] of entries) lines.push(`  ${label} ${name(key)}: ${c.text}`);
    };

    list("reads", s.reads.vars);
    list("constants", s.reads.constants);
    list("writes", s.writes.vars);
    list("invokes", s.invokes, (p) => (p as ts.Symbol).name);
    list("escapes", s.escapes);
    list("returns", s.returns);

    if (s.mutates) lines.push(`  mutates: ${s.mutates.text}`);

    return lines.join("\n");
  }
}
