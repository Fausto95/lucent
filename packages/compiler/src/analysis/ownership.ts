/**
 * Owner checks over the summaries: whether a unit's code can run on a
 * given execution context (an isolated compute task, the main thread),
 * whether a value can be handed to another context, and which contexts
 * run each unit. Every refusal carries its cause path, so a message can
 * say why: `run` calls `decode`, which reads module state `cache`.
 */
import path from "node:path";
import ts from "typescript";
import type { OwnerId } from "../ir/ir.ts";
import { coreTypesPath, isLibFile } from "../program.ts";
import { type Cause, code, describe, step, type Step, stepsOf, type Summary } from "./facts.ts";
import { declaredAt, tracked } from "./local.ts";
import type { MainState } from "./main-state.ts";
import type { NativeFactsSource } from "./native.ts";
import type { Solved } from "./solve.ts";
import type { Unit } from "./units.ts";

/** Where code may be asked to run: an isolated compute task, or the main (UI) thread. */
export type Context = "task" | "main";

export type Rule =
  /** It reads or writes mutable module state, which the module's own thread owns. */
  | "module-state"
  /** It reads a module constant that is not a literal, which a reload assigns again. */
  | "module-constant"
  /** It uses native code that must run on the main thread. */
  | "main-thread"
  /** It uses native code that must run off the main thread. */
  | "worker-thread"
  /** It uses native code whose thread requirement is unknown. */
  | "unknown-thread"
  /** It uses native code known to block. */
  | "blocking"
  /** It calls code the compiler cannot see: anything may happen. */
  | "unknown-code"
  /** It starts asynchronous work (await, promises, main()), which continues on its context. */
  | "asynchronous"
  /** A value it uses cannot be handed to another context. */
  | "not-transferable";

export interface Violation {
  readonly rule: Rule;
  readonly unit: Unit;
  /** "`run` cannot run in a compute task: it calls `decode` (m.lucent.ts:4:3), which reads …". */
  readonly message: string;
  /** The path from `unit` to what breaks the rule. */
  readonly cause: Cause;
  readonly steps: readonly Step[];
  /** One concrete way out. */
  readonly fix: string;
}

const CONTEXTS: Record<Context, string> = {
  task: "in a compute task",
  main: "on the main thread",
};

const FIXES: Record<Rule, string> = {
  "module-state": "pass what it needs as an input, and apply its result on the module's thread",
  "module-constant":
    "make the constant a literal (a number, string, boolean or bigint), or pass its value as an input",
  "main-thread": "use the native object on the main thread, and give the task plain data",
  "worker-thread": "call the native API from a compute task or the module's thread",
  "unknown-thread": "use the native API where its thread is known to be safe",
  blocking: "call the blocking native API from a compute task",
  "unknown-code": "call functions the compiler can resolve (declared functions, known closures)",
  asynchronous: "keep the work synchronous, or await it on the calling side",
  "not-transferable": "pass plain data (numbers, strings, arrays, records, bytes) instead",
};

type SummaryRule = Exclude<Rule, "not-transferable">;

/** What `rule` refuses in a summary, with the module variable's key for module state. */
function findings(rule: SummaryRule, s: Summary): [string | undefined, Cause | undefined][] {
  if (rule === "module-state")
    return [...s.reads.vars.entries(), ...[...s.writes.vars].filter(([k]) => !s.reads.vars.has(k))];

  return FINDINGS[rule](s).map((c) => [undefined, c]);
}

/** The facts of a summary each rule refuses, in a fixed order. */
const FINDINGS: Record<
  Exclude<SummaryRule, "module-state">,
  (s: Summary) => (Cause | undefined)[]
> = {
  "module-constant": (s) => [...s.reads.constants.values()],
  "main-thread": (s) => [s.affinity.main],
  "worker-thread": (s) => [s.affinity.worker],
  "unknown-thread": (s) => [s.affinity.unknown],
  blocking: (s) => [s.blocking.yes],
  "unknown-code": (s) => [s.reads.unknown ?? s.writes.unknown ?? s.callbacks.unknown],
  asynchronous: (s) => [s.suspends ?? s.schedules],
};

/**
 * What each context refuses. The main thread accepts native code of
 * unknown thread (most platform APIs are main-thread APIs); a task does not.
 */
const REFUSES: Record<Context, readonly SummaryRule[]> = {
  task: [
    "module-state",
    "module-constant",
    "unknown-code",
    "main-thread",
    "unknown-thread",
    "asynchronous",
  ],
  main: ["module-state", "unknown-code", "worker-thread", "blocking"],
};

function violation(rule: Rule, unit: Unit, context: Context, cause: Cause): Violation {
  return {
    rule,
    unit,
    message: `${code(unit.display)} cannot run ${CONTEXTS[context]}: it ${describe(cause)}.`,
    cause,
    steps: stepsOf(cause),
    fix: FIXES[rule],
  };
}

/**
 * Why `unit` (its code and everything it runs) cannot run on `context`;
 * empty when it can. On the main thread, `main` says which module state is
 * the main thread's own (main-state.ts), and why the rest is not.
 */
export function checkUnit(
  summary: Summary,
  unit: Unit,
  context: Context,
  main?: MainState,
): Violation[] {
  const out: Violation[] = [];
  const seen = new Set<string>();
  const shared = context === "main" ? main : undefined;

  for (const rule of REFUSES[context])
    for (const [key, cause] of findings(rule, summary)) {
      if (!cause) continue;

      const reason = key === undefined ? undefined : shared?.why.get(key);

      if (key !== undefined && shared?.why.has(key) && !reason) continue;

      const found = violation(rule, unit, context, cause);
      const v = reason
        ? {
            ...found,
            message: `${found.message} It is not the main thread's alone: ${reason}.`,
            fix: `${FIXES["module-state"]}, or use it only in components and main(…) callbacks, holding plain values or native objects`,
          }
        : found;

      if (seen.has(v.message)) continue;

      seen.add(v.message);
      out.push(v);
    }

  return out;
}

/** A value that cannot be handed to another context: where in it, and what it is. */
export interface TransferProblem {
  /** `opts.view`, `items[i]`. */
  readonly path: string;
  readonly reason: string;
}

/** Library types copied whole to another context. */
const COPIED = new Set(["Uint8Array", "ArrayBuffer", "Date"]);

const BORROWED = "a byte span, which lives only for the borrow that lent it";

/** lucent:core's types that are not data: a buffer moves (null: it can), a span cannot leave its borrow. */
const CORE: Record<string, string | null> = {
  NativeBuffer: null,
  ByteSpan: BORROWED,
  MutableByteSpan: BORROWED,
  EventEmitter: "an event emitter, whose listeners run on the context that added them",
  EventSubscription: "an event subscription, which belongs to the context that made it",
};

/** Library types that belong to the context that made them. */
const OWNED: Record<string, string> = {
  Promise: "a promise, which settles on the context that made it",
  AbortSignal: "an abort signal, which belongs to the context that made it",
  AbortController: "an abort controller, which belongs to the context that made it",
  WeakRef: "a weak reference, which belongs to the context that made it",
  Generator: "a generator, which runs code on the context that made it",
  Iterator: "an iterator, which runs code on the context that made it",
  IterableIterator: "an iterator, which runs code on the context that made it",
};

/** Library collections: their type arguments are what they hold. */
const COLLECTIONS: Record<string, (path: string, i: number) => string> = {
  Array: (path) => `${path}[i]`,
  ReadonlyArray: (path) => `${path}[i]`,
  Set: (path) => `${path} (an element)`,
  ReadonlySet: (path) => `${path} (an element)`,
  Map: (path, i) => (i === 0 ? `${path} (a key)` : `${path}.get(…)`),
  ReadonlyMap: (path, i) => (i === 0 ? `${path} (a key)` : `${path}.get(…)`),
};

/**
 * Whether values of `type` can be handed to another context as data:
 * copied (primitives, arrays, records, bytes, Lucent objects of such
 * fields), or native objects of a known thread-safe kind. The first part
 * that cannot cross, or undefined.
 */
export function transferProblem(
  checker: ts.TypeChecker,
  native: NativeFactsSource,
  type: ts.Type,
  path: string,
): TransferProblem | undefined {
  return new Transfer(checker, native).check(type, path);
}

function isCoreFile(sf: ts.SourceFile): boolean {
  return path.resolve(sf.fileName) === path.resolve(coreTypesPath());
}

class Transfer {
  private readonly seen = new Set<ts.Type>();
  private readonly checker: ts.TypeChecker;
  private readonly native: NativeFactsSource;

  constructor(checker: ts.TypeChecker, native: NativeFactsSource) {
    this.checker = checker;
    this.native = native;
  }

  check(t: ts.Type, path: string): TransferProblem | undefined {
    if (!tracked(t) || this.seen.has(t)) return undefined;

    this.seen.add(t);

    if (t.isUnion()) return this.first(t.types, () => path);

    if (t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))
      return { path, reason: "a value of unknown type" };

    if (t.flags & ts.TypeFlags.TypeParameter) {
      const name = code(this.checker.typeToString(t));

      return { path, reason: `a value of the generic type ${name}, which may be anything` };
    }

    if (t.getCallSignatures().length) return { path, reason: "a function" };

    if (this.checker.isTupleType(t))
      return this.first(
        this.checker.getTypeArguments(t as ts.TypeReference),
        (i) => `${path}[${i}]`,
      );

    const symbol = t.getSymbol() ?? t.aliasSymbol;
    const decl = symbol?.declarations?.[0];
    const name = symbol?.getName() ?? "";

    if (decl && isLibFile(decl.getSourceFile())) return this.library(t, name, path);

    if (decl && isCoreFile(decl.getSourceFile()) && Object.hasOwn(CORE, name)) {
      const reason = CORE[name];

      return reason ? { path, reason } : undefined;
    }

    const cls = decl && this.native.classOf(decl);

    if (cls?.affinity === "main")
      return { path, reason: `a main-thread native object (${cls.display})` };

    if (cls?.affinity === "unknown")
      return { path, reason: `a native object with no known thread requirement (${cls.display})` };

    if (cls) return undefined;

    if (decl?.getSourceFile().isDeclarationFile)
      return { path, reason: `a ${code(name)}, which the compiler cannot copy` };

    return this.fields(t, path);
  }

  private library(t: ts.Type, name: string, path: string): TransferProblem | undefined {
    if (COPIED.has(name)) return undefined;

    const owned = OWNED[name];

    if (owned) return { path, reason: owned };

    const element = COLLECTIONS[name];

    if (element)
      return this.first(this.checker.getTypeArguments(t as ts.TypeReference), (i) =>
        element(path, i),
      );

    return { path, reason: `a ${code(name)}, which the compiler cannot copy` };
  }

  private first(
    types: readonly ts.Type[],
    path: (i: number) => string,
  ): TransferProblem | undefined {
    for (const [i, t] of types.entries()) {
      const problem = this.check(t, path(i));
      if (problem) return problem;
    }

    return undefined;
  }

  /** An object: each of its data fields (methods and accessors are code, not data). */
  private fields(t: ts.Type, path: string): TransferProblem | undefined {
    for (const p of this.checker.getPropertiesOfType(t)) {
      const decl = p.valueDeclaration ?? p.declarations?.[0];
      const code =
        decl &&
        (ts.isMethodDeclaration(decl) ||
          ts.isGetAccessorDeclaration(decl) ||
          ts.isSetAccessorDeclaration(decl));

      if (code) continue;

      const problem = this.check(this.checker.getTypeOfSymbol(p), `${path}.${p.getName()}`);

      if (problem) return problem;
    }

    return undefined;
  }
}

/** A variable a closure uses from the code that created it. */
export interface Capture {
  readonly symbol: ts.Symbol;
  readonly name: string;
  /** The unit that declares it. */
  readonly declaredIn: Unit;
  /** Where the closure first uses it. */
  readonly node: ts.Node;
}

/** The variables `unit` captures, in the order it first uses them. */
export function capturesOf(solved: Solved, unit: Unit): Capture[] {
  const local = solved.locals.get(unit);
  if (!local) return [];

  return [...local.captured].flatMap(([symbol, node]) => {
    const declaredIn = solved.p.graph.declaredIn.get(symbol);

    return declaredIn ? [{ symbol, name: symbol.name, declaredIn, node }] : [];
  });
}

/**
 * Why what `unit` captures cannot go with it to `context`: module state a
 * variable may be, a value that cannot cross, a captured closure whose
 * code or captures cannot. Empty when everything can.
 */
export function checkCaptures(
  solved: Solved,
  check: (u: Unit) => Violation[],
  unit: Unit,
  context: Context,
  seen: Set<Unit> = new Set(),
): Violation[] {
  const out: Violation[] = [];
  const checker = solved.p.checker;

  seen.add(unit);

  for (const c of capturesOf(solved, unit)) {
    const declaration = c.symbol.valueDeclaration ?? c.node;
    const captures = `captures ${code(c.name)} (${declaredAt(declaration)})`;
    const cause = (text: string, next?: Cause) => step(unit, c.node, text, next);
    const origins = solved.originsOf([c.symbol]);

    for (const m of origins.modules) {
      const v = solved.p.units.moduleVars.get(m)!;
      const why = cause(`${captures}, which may be module state ${code(v.name)}, ${v.state}`);

      out.push(violation("module-state", unit, context, why));
    }

    for (const f of origins.functions) {
      if (seen.has(f)) continue;

      for (const inner of [...check(f), ...checkCaptures(solved, check, f, context, seen)])
        out.push(
          violation(inner.rule, unit, context, cause(`${captures}, a closure`, inner.cause)),
        );
    }

    if (origins.functions.length) continue;

    const problem = transferProblem(
      checker,
      solved.p.native,
      checker.getTypeOfSymbol(c.symbol),
      c.name,
    );

    if (problem) {
      const part = problem.path.slice(c.name.length).replace(/^\./, "");
      const whose = part ? `whose ${code(part)} is` : "which is";

      out.push(
        violation(
          "not-transferable",
          unit,
          context,
          cause(`${captures}, ${whose} ${problem.reason}`),
        ),
      );
    }
  }

  return out;
}

/** How one unit runs another: in its own context, or on the main thread. */
interface Runs {
  readonly from: Unit;
  readonly to: Unit;
  readonly node: ts.Node;
  readonly main: boolean;
}

/**
 * The contexts that may run each unit, and why: as an entry point (an
 * export, a module's initialization, a native callback), through its
 * callers, or anywhere when its function value escapes to code the
 * compiler cannot see.
 */
export function ownersOf(
  solved: Solved,
  mainRoots: ReadonlySet<ts.Node> = new Set(),
): Map<Unit, Map<OwnerId, Cause>> {
  const owners = new Map<Unit, Map<OwnerId, Cause>>();
  const add = (u: Unit, owner: OwnerId, cause: Cause): boolean => {
    let map = owners.get(u);
    if (!map) owners.set(u, (map = new Map()));
    if (map.has(owner)) return false;

    map.set(owner, cause);
    return true;
  };

  for (const u of solved.p.units.list) {
    if (u.kind === "module-init")
      add(u, "legacy-module", step(u, u.node, "initializes its module"));
    else if (mainRoots.has(u.node))
      add(u, "main", step(u, u.node, "is a component's setup: it runs on the main thread"));
    else if (u.exported)
      add(u, "legacy-module", step(u, u.node, "is exported: JavaScript calls it"));
  }

  for (const e of solved.entries) add(e.unit, e.owner, e.cause);

  for (const [node, u] of solved.p.graph.functions) {
    const lost = solved.escapesOf(node, u.parent ?? u, true).find((x) => !x.dispatched);

    if (lost) add(u, "unknown", step(u, node, `escapes: it ${describe(lost.cause)}`));
  }

  const runs = runsOf(solved);

  for (let changed = true; changed;) {
    changed = false;

    for (const r of runs)
      for (const [owner, why] of owners.get(r.from) ?? []) {
        const target: OwnerId = r.main ? "main" : owner;
        const text = `${r.main ? "runs on the main thread: " : "is run by "}${code(r.from.display)}`;

        if (add(r.to, target, step(r.from, r.node, text, why))) changed = true;
      }
  }

  // Closures and methods no known call runs: run through interfaces or values it cannot follow.
  for (const u of solved.p.units.list)
    if (!owners.get(u)?.size && u.kind !== "function")
      add(u, "unknown", step(u, u.node, "is called only where the compiler cannot follow"));

  return owners;
}

/** Every way one unit runs another: its edges, and the functions it passes to callees that call them. */
function runsOf(solved: Solved): Runs[] {
  const out: Runs[] = [];

  for (const u of solved.p.units.list)
    for (const e of solved.edges.get(u) ?? [])
      for (const t of e.targets) {
        const main = e.mode === "main";

        out.push({ from: u, to: t, node: e.node, main });

        for (const [param] of solved.summaries.get(t)!.invokes) {
          const p = solved.p.graph.params.get(param);
          const values = p?.unit === t ? e.site?.args[p.index] : undefined;

          for (const g of values ? solved.functionsOf(values).units : [])
            out.push({ from: u, to: g, node: e.node, main });
        }
      }

  return out;
}
