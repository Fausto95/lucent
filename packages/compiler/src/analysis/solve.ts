/**
 * Transitive summaries: each unit's own facts joined with those of the
 * units it calls, the callbacks it runs and, at native calls, the Lucent
 * code native code may call back. Facts only rise, so iterating to a
 * fixed point terminates, recursion included; units are processed in a
 * fixed order and keep the first cause found, so the result and its
 * explanations are the same on every build.
 */
import ts from "typescript";
import type { OwnerId } from "../ir/ir.ts";
import { type Cause, code, type Levels, step, type Summary, SummaryBuilder } from "./facts.ts";
import {
  type Callee,
  type CallSite,
  Collector,
  type EscapeKind,
  type FlowGraph,
  type FlowKind,
  type LocalFacts,
  type Program,
  ThisValue,
  type Value,
  within,
} from "./local.ts";
import { parameterSymbol } from "./scopes.ts";
import type { ModuleVar, Unit } from "./units.ts";

/** How an edge's callee runs: during the call, later on the same context, or on the main thread. */
export type EdgeMode = "during" | "later" | "main";

/** A call from one unit to others, resolved. */
export interface Edge {
  readonly from: Unit;
  readonly node: ts.Node;
  readonly text: string;
  readonly targets: readonly Unit[];
  readonly mode: EdgeMode;
  /** It calls a function value (a closure, a callback), not a declaration. */
  readonly callback: boolean;
  /** What the functions its callees are given are: a promise's settle functions. */
  readonly offers?: "settle";
  /** The call site, whose arguments bind the callees' parameters; none for callbacks. */
  readonly site?: CallSite;
}

/** Lucent code native code runs: a callback it keeps, or a method it calls. */
export interface NativeEntry {
  readonly unit: Unit;
  readonly owner: OwnerId;
  readonly cause: Cause;
  /**
   * Whether it may run during a native call: unless the platform's call of
   * it is queued on the Lucent thread (a turn of its own, later), or the
   * runtime runs it (a compute task). Unknown delivery may.
   */
  readonly reentrant: boolean;
}

/** What a function value may be: known units, parameters, or something else. */
export interface Functions {
  readonly units: readonly Unit[];
  readonly params: readonly ts.Symbol[];
  readonly unknown?: string;
}

/** Where values may come from. */
export interface Origins {
  /** Module variables holding objects they may be. */
  readonly modules: readonly ts.Symbol[];
  readonly params: readonly ts.Symbol[];
  readonly functions: readonly Unit[];
  /** `this`. */
  readonly self: boolean;
  /** Nothing but objects made in the program's own code, which no one else has. */
  readonly fresh: boolean;
  /** Made elsewhere or read out of other objects: a call's result, a field. */
  readonly other: boolean;
}

export interface Escape {
  readonly kind: EscapeKind;
  /** The unit whose code lets the value go. */
  readonly unit: Unit;
  readonly cause: Cause;
  /** Handed to code that runs it later on a known context (a callback), not lost. */
  readonly dispatched: boolean;
}

/** Everything the solver computes, for the queries. */
export interface Solved {
  readonly p: Program;
  readonly locals: ReadonlyMap<Unit, LocalFacts>;
  readonly summaries: ReadonlyMap<Unit, Summary>;
  readonly edges: ReadonlyMap<Unit, readonly Edge[]>;
  readonly entries: readonly NativeEntry[];
  functionsOf(values: readonly Value[]): Functions;
  originsOf(values: readonly Value[]): Origins;
  /**
   * How `start` (a parameter, a borrowed variable) can outlive `root`'s
   * code. A return from `root` itself is its result, not an escape,
   * unless `returns`.
   */
  escapesOf(start: Value, root: Unit, returns?: boolean): Escape[];
}

/** Resolves one kind of callee of a call site. */
type Resolver<C extends Callee> = (
  callee: C,
  site: CallSite,
  own: SummaryBuilder,
  edges: Edge[],
) => void;

/** Collects every unit, resolves calls and flows, and iterates summaries to a fixed point. */
export function solve(p: Program): Solved {
  return new Solver(p).run();
}

interface PathStep {
  readonly unit: Unit;
  readonly node: ts.Node;
  readonly text: string;
}

/** The flows `backward` follows into a value: the value is (part of) what they carry. */
const BACK: ReadonlySet<FlowKind> = new Set(["bind", "alias", "part"]);

class Solver implements Solved {
  readonly p: Program;
  readonly locals = new Map<Unit, LocalFacts>();
  readonly summaries = new Map<Unit, SummaryBuilder>();
  readonly edges = new Map<Unit, Edge[]>();
  readonly entries: NativeEntry[] = [];
  /** Native calls, by unit: native code may call back any entry there. */
  private readonly reentries = new Map<Unit, Cause[]>();
  /** A closure's uses of variables whose values its creator computed. */
  private readonly captures = new Map<Unit, { from: Unit; cause: Cause }[]>();
  /** For each value, the calls that pass it and where. */
  private readonly passed = new Map<
    Value,
    { site: CallSite; index: number; targets: readonly Unit[] }[]
  >();
  private readonly graph: FlowGraph;
  private readonly keys: ReadonlyMap<string, ModuleVar>;
  private readonly moduleObjects: boolean;

  constructor(p: Program) {
    this.p = p;
    this.graph = p.graph;

    const vars = [...p.units.moduleVars.values()];

    this.keys = new Map(vars.map((v) => [v.key, v]));
    this.moduleObjects = vars.some((v) => v.reference && !!v.state);
  }

  run(): Solved {
    for (const u of this.p.units.list) this.locals.set(u, new Collector(this.p, u).collect());

    for (const u of this.p.units.list) this.resolve(u);

    this.implementations();
    this.fixpoint();
    return this;
  }

  private moduleVar(v: Value): ModuleVar | undefined {
    return isSymbol(v) ? this.p.units.moduleVars.get(v) : undefined;
  }

  // --- resolution ------------------------------------------------------------------

  private resolve(u: Unit): void {
    const local = this.locals.get(u)!;
    const edges: Edge[] = [];

    this.summaries.set(u, local.own);
    this.edges.set(u, edges);

    for (const site of local.calls) this.site(site, local.own, edges);

    for (const m of local.mutations) this.mutation(u, m.values, m.node, m.text);

    for (const [sym, node] of local.captured) this.captured(u, sym, node);
  }

  private site(site: CallSite, own: SummaryBuilder, edges: Edge[]): void {
    const resolve = this.callees[site.callee.kind] as Resolver<Callee>;

    resolve(site.callee, site, own, edges);
  }

  /** A call's direct callees: edges that bind their parameters to its arguments. */
  private direct(site: CallSite, edges: Edge[], targets: readonly Unit[], callback: boolean): void {
    if (!targets.length) return;

    edges.push({
      from: site.unit,
      node: site.node,
      text: site.text,
      targets,
      mode: "during",
      callback,
      site,
    });
    this.pass(site, targets);
  }

  /** How each kind of callee resolves to edges and facts. */
  private readonly callees: { [K in Callee["kind"]]: Resolver<Extract<Callee, { kind: K }>> } = {
    units: (callee, site, _own, edges) => this.direct(site, edges, callee.units, false),

    value: (callee, site, own, edges) => {
      const fns = this.functionsOf(callee.values);

      this.direct(site, edges, fns.units, true);
      this.invokes(own, site.unit, fns.params, site.node, site.text);

      if (fns.unknown) this.unknownCall(site, own, `${site.text}: ${fns.unknown}`);
    },

    literal: (callee, site, own, edges) => {
      const { terminals } = this.backward(callee.receiver, false, false);
      const exact = terminals.size > 0 && [...terminals.keys()].every((t) => t === callee.literal);

      if (exact) this.direct(site, edges, [callee.unit], false);
      else this.unknownCall(site, own, `${site.text}: on an object the compiler cannot follow`);
    },

    library: (callee, site, own, edges) => {
      const effect = callee.member.effect;

      if (effect?.task) return this.taskEntries(site);

      const mode: EdgeMode = effect?.main ? "main" : effect?.calls === "later" ? "later" : "during";

      // A member whose effects are not known may call any function it is given.
      if (!effect || effect.calls || effect.main)
        this.callbacks(site, own, edges, () => mode, effect?.settles ? "settle" : undefined);
    },

    native: (callee, site, own, edges) => {
      const use = callee.use;

      if (use.constant) return;

      push(this.reentries, site.unit, step(site.unit, site.node, site.text));
      this.callbacks(site, own, edges, (i) =>
        use.callbacks.get(i)?.timing === "escaping" ? undefined : "during",
      );
      this.nativeEntries(site);
    },

    // Unknown code may call the functions it is given at any time.
    unknown: (_callee, site, own, edges) => this.callbacks(site, own, edges, () => "during"),
  };

  /** Records which values a call passes to which callees, for escapes. */
  private pass(site: CallSite, targets: readonly Unit[]): void {
    site.args.forEach((values, index) => {
      for (const v of values) push(this.passed, v, { site, index, targets });
    });
  }

  /** The function arguments a call runs (a library's `map`, a native callback): edges to them. */
  private callbacks(
    site: CallSite,
    own: SummaryBuilder,
    edges: Edge[],
    mode: (index: number) => EdgeMode | undefined,
    offers?: "settle",
  ): void {
    site.args.forEach((values, index) => {
      const how = mode(index);
      if (!how || !site.functions[index]) return;

      const fns = this.functionsOf(values);
      const text = `${site.text}, which calls ${fns.units.map((f) => code(f.display)).join(", ") || "it"}`;

      if (fns.units.length)
        edges.push({
          from: site.unit,
          node: site.node,
          text,
          targets: fns.units,
          mode: how,
          callback: true,
          ...(offers ? { offers } : {}),
        });

      this.invokes(own, site.unit, fns.params, site.node, text);

      if (fns.unknown)
        own.level(own.callbacks, "unknown", step(site.unit, site.node, `${text}: ${fns.unknown}`));
    });
  }

  /** Functions native code keeps: it calls them back later, on the context its plan says. */
  private nativeEntries(site: CallSite): void {
    if (site.callee.kind !== "native") return;

    const use = site.callee.use;

    for (const [index, cb] of use.callbacks) {
      if (cb.timing === "during-call") continue;

      const owner: OwnerId = cb.main
        ? "main"
        : cb.delivery === "queued"
          ? "legacy-module"
          : "unknown";
      const text = `is passed to ${code(use.display)}, which calls it back`;

      for (const unit of this.functionsOf(site.args[index] ?? []).units)
        this.entries.push({
          unit,
          owner,
          cause: step(site.unit, site.node, text),
          reentrant: cb.delivery !== "queued",
        });
    }
  }

  /** The function compute runs: an entry of its own, on a worker, not run by its caller. */
  private taskEntries(site: CallSite): void {
    const text = "is passed to `compute`, which runs it on a worker";

    for (const unit of this.functionsOf(site.args[0] ?? []).units)
      this.entries.push({
        unit,
        owner: "task",
        cause: step(site.unit, site.node, text),
        reentrant: false,
      });
  }

  private invokes(
    own: SummaryBuilder,
    u: Unit,
    params: readonly ts.Symbol[],
    node: ts.Node,
    text: string,
  ): void {
    for (const param of params)
      own.entry(
        own.invokes,
        param,
        step(u, node, `${text} (${code(param.name)}, which its caller passes)`),
      );
  }

  private unknownCall(site: CallSite, own: SummaryBuilder, text: string): void {
    const c = step(site.unit, site.node, text);

    own.anything(c);

    for (const values of site.args)
      for (const v of values)
        this.graph.sink(v, {
          kind: "passed",
          unit: site.unit,
          node: site.node,
          text: `is passed to ${text}`,
        });
  }

  /** A mutation: of module state, of an object the unit made, or of one it did not. */
  private mutation(u: Unit, values: readonly Value[], node: ts.Node, text: string): void {
    const own = this.summaries.get(u)!;
    const origins = this.originsOf(values);

    for (const sym of origins.modules) {
      const v = this.moduleVar(sym)!;
      const says = values.includes(sym)
        ? `${text} (module state ${code(v.name)})`
        : `${text}, which may be module state ${code(v.name)}`;

      own.entry(own.writes.vars, v.key, step(u, node, says));
    }

    const foreign = !values.length || origins.params.length > 0 || origins.self || origins.other;
    const constructing =
      u.kind === "constructor" && origins.self && !origins.params.length && !origins.other;

    if (foreign && !constructing)
      own.flag("mutates", step(u, node, `${text}, an object it did not create`));
  }

  /** A captured variable: what its value may be decides what using it reads. */
  private captured(u: Unit, sym: ts.Symbol, node: ts.Node): void {
    const own = this.summaries.get(u)!;
    const origins = this.originsOf([sym]);

    for (const m of origins.modules) {
      const v = this.moduleVar(m)!;
      const text = `uses ${code(sym.name)}, which may be module state ${code(v.name)}, ${v.state}`;

      own.entry(own.reads.vars, v.key, step(u, node, text));
    }

    const declared = this.graph.declaredIn.get(sym);

    if (origins.other && declared) {
      const text = `uses ${code(sym.name)}, which ${code(declared.display)} computed`;

      push(this.captures, u, { from: declared, cause: step(u, node, text) });
    }
  }

  /** Lucent methods the platform calls (protocol requirements, overrides): native entries. */
  private implementations(): void {
    for (const u of this.p.units.list) {
      if (!u.class || !ts.isMethodDeclaration(u.node)) continue;

      const use = this.p.native.implemented(this.p.checker, u.node);
      if (!use) continue;

      const owner: OwnerId =
        use.facts.affinity === "main"
          ? "main"
          : use.delivery === "queued"
            ? "legacy-module"
            : "unknown";
      const text = `implements ${code(use.display)}, which the platform calls`;

      this.entries.push({
        unit: u,
        owner,
        cause: step(u, u.node, text),
        reentrant: use.delivery !== "queued",
      });
    }
  }

  // --- values ----------------------------------------------------------------------

  /**
   * Walks the flows into `values` backward, through variables, aliases and
   * reads out of objects (and, once inside an object, what it holds). The
   * terminals are where the values come from. `throughModules`: module
   * variables are followed to what is stored in them, rather than ending
   * the walk.
   */
  private backward(
    values: readonly Value[],
    deep: boolean,
    throughModules: boolean,
  ): { terminals: Map<Value, boolean> } {
    const terminals = new Map<Value, boolean>();
    const seen = new Map<Value, boolean>();
    const queue: [Value, boolean][] = values.map((v) => [v, deep]);

    for (let i = 0; i < queue.length; i++) {
      const [v, inside] = queue[i]!;

      if (seen.get(v) === true || seen.get(v) === inside) continue;
      seen.set(v, inside);

      const into = (this.graph.backward.get(v) ?? []).filter(
        ({ flow }) => BACK.has(flow.kind) || (inside && flow.kind === "contain"),
      );
      const moduleVar = !!this.moduleVar(v);
      const param = isSymbol(v) && this.graph.params.has(v);

      if ((moduleVar && !throughModules) || param || !into.length) terminals.set(v, inside);

      if (moduleVar && !throughModules) continue;

      for (const { from, flow } of into) queue.push([from, inside || flow.kind === "part"]);
    }

    return { terminals };
  }

  originsOf(values: readonly Value[]): Origins {
    const { terminals } = this.backward(values, false, false);
    const modules: ts.Symbol[] = [];
    const params: ts.Symbol[] = [];
    const functions: Unit[] = [];
    let self = false;
    let other = false;
    let made = 0;

    for (const t of terminals.keys()) {
      if (t instanceof ThisValue) {
        self = true;
        continue;
      }

      if (isSymbol(t)) {
        const v = this.moduleVar(t);

        if (v) {
          if (v.state && v.reference) modules.push(t);
        } else if (this.graph.params.has(t)) params.push(t);
        else other = true;
        continue;
      }

      const kind = this.graph.kinds.get(t);

      if (kind === "function") functions.push(this.graph.functions.get(t)!);
      else if (kind === "fresh") made++;
      else other = true;
    }

    const fresh = terminals.size > 0 && made + functions.length === terminals.size;

    return { modules, params, functions, self, fresh, other };
  }

  functionsOf(values: readonly Value[]): Functions {
    const { terminals } = this.backward(values, false, true);
    const units: Unit[] = [];
    const params: ts.Symbol[] = [];
    let unknown = terminals.size ? undefined : "a function value the compiler cannot follow";

    for (const [t, inside] of terminals) {
      const unit =
        isNode(t) && this.graph.kinds.get(t) === "function"
          ? this.graph.functions.get(t)
          : undefined;

      if (unit) {
        if (!units.includes(unit)) units.push(unit);
      } else if (isSymbol(t) && this.graph.params.has(t) && !inside) params.push(t);
      else unknown ??= "a function value the compiler cannot follow";
    }

    return { units, params, ...(unknown ? { unknown } : {}) };
  }

  escapesOf(start: Value, root: Unit, returns = false): Escape[] {
    const out: Escape[] = [];
    const seen = new Set<Value>([start]);
    const queue: { v: Value; path: readonly PathStep[] }[] = [{ v: start, path: [] }];
    const found = (
      kind: EscapeKind,
      path: readonly PathStep[],
      last: PathStep & { dispatched?: true },
      next?: Cause,
    ) => {
      const steps = [...path, last];
      let cause = next;

      for (let i = steps.length - 1; i >= 0; i--)
        cause = step(steps[i]!.unit, steps[i]!.node, steps[i]!.text, cause);

      out.push({ kind, unit: last.unit, cause: cause!, dispatched: !!last.dispatched });
    };

    for (let i = 0; i < queue.length; i++) {
      const { v, path } = queue[i]!;

      for (const s of this.graph.sinks.get(v) ?? []) {
        if (!within(s.unit, root) || (s.kind === "returned" && s.unit === root && !returns))
          continue;

        found(s.kind, path, s);
      }

      for (const use of this.passed.get(v) ?? [])
        for (const t of use.targets) {
          const summary = this.summaries.get(t)!;
          const text = `is passed to ${code(t.display)}`;
          const kept = summary.escapes.get(use.index);
          const given = summary.returns.get(use.index);
          const at = { unit: use.site.unit, node: use.site.node };

          if (kept) found("passed", path, { ...at, text: `${text}, which keeps it` }, kept);

          if (given && !seen.has(use.site.node)) {
            seen.add(use.site.node);
            queue.push({
              v: use.site.node,
              path: [...path, { ...at, text: `${text}, which returns it` }],
            });
          }
        }

      for (const f of this.graph.forward.get(v) ?? []) {
        if (f.kind === "part" || seen.has(f.to)) continue;

        const leaves = this.leaves(f.to, root, f.kind);

        if (leaves) {
          found("stored", path, { unit: f.unit, node: f.node, text: `${f.text}, which ${leaves}` });
          continue;
        }

        seen.add(f.to);
        queue.push({ v: f.to, path: [...path, f] });
      }
    }

    return out;
  }

  /** Why a flow of `kind` into `to` leaves `root`'s code, or undefined when `to` is `root`'s own. */
  private leaves(to: Value, root: Unit, kind: FlowKind): string | undefined {
    const reachable = "other code can reach";

    if (to instanceof ThisValue) return reachable;

    if (this.moduleVar(to)) return "is module state";

    if (isSymbol(to)) {
      const declared = this.graph.declaredIn.get(to);

      if (!declared || !within(declared, root)) return `is outside ${code(root.display)}`;

      return kind === "contain" && !this.originsOf([to]).fresh ? reachable : undefined;
    }

    return kind === "contain" && this.graph.kinds.get(to) !== "fresh" ? reachable : undefined;
  }

  // --- fixed point -----------------------------------------------------------------

  private fixpoint(): void {
    const list = this.p.units.list;
    const index = new Map(list.map((u, i) => [u, i]));
    const dependents = list.map(() => new Set<number>());
    const depend = (on: Unit, u: Unit) => dependents[index.get(on)!]!.add(index.get(u)!);

    for (const [u, edges] of this.edges)
      for (const e of edges) for (const t of e.targets) depend(t, u);

    for (const [u, list] of this.captures) for (const c of list) depend(c.from, u);

    for (const u of this.reentries.keys())
      for (const e of this.entries) if (e.reentrant) depend(e.unit, u);

    const dirty = list.map(() => true);

    for (let i = 0; i < dirty.length;) {
      if (!dirty[i]) {
        i++;
        continue;
      }

      dirty[i] = false;

      if (!this.update(list[i]!)) {
        i++;
        continue;
      }

      let first = i + 1;

      for (const d of dependents[i]!) {
        dirty[d] = true;
        first = Math.min(first, d);
      }

      i = first;
    }
  }

  /** Recomputes `u`'s summary from what it depends on; whether anything rose. */
  private update(u: Unit): boolean {
    const s = this.summaries.get(u)!;

    for (const e of this.edges.get(u) ?? []) for (const t of e.targets) this.join(s, u, e, t);

    for (const c of this.captures.get(u) ?? [])
      for (const [key, cause] of this.summaries.get(c.from)!.reads.vars)
        s.entry(s.reads.vars, key, { ...c.cause, next: cause });

    for (const cause of this.reentries.get(u) ?? []) this.reenter(s, cause);

    this.reach(s, u);
    this.params(s, u);
    return s.settle();
  }

  /** Joins what `t` does into `s`, the summary of `u`, which runs it through `e`. */
  private join(s: SummaryBuilder, u: Unit, e: Edge, t: Unit): void {
    const from = this.summaries.get(t)!;
    const text = e.targets.length > 1 && !e.callback ? `${e.text} (${code(t.display)})` : e.text;
    const via = (c: Cause) => step(u, e.node, text, c);

    joinEffects(s, from, via, { affinity: e.mode !== "main" });

    if (t.async && e.mode === "during")
      s.flag("schedules", step(u, e.node, `${text}, which is async`));

    if (from.schedules) s.flag("schedules", via(from.schedules));

    if (e.callback) s.level(s.callbacks, "known", step(u, e.node, text));

    this.bind(s, u, e, t, from);
  }

  /** The functions `t` calls through its parameters: those this call passes. */
  private bind(s: SummaryBuilder, u: Unit, e: Edge, t: Unit, from: Summary): void {
    for (const [param, c] of from.invokes) {
      const p = this.graph.params.get(param);

      // A parameter of an enclosing unit the callee (a closure) calls: still open here.
      if (!p || p.unit !== t) {
        s.entry(s.invokes, param, step(u, e.node, e.text, c));
        continue;
      }

      // A promise executor's parameters settle its promise: it continues later.
      if (e.offers === "settle") {
        s.flag("schedules", step(u, e.node, `${e.text}, which settles a promise`, c));
        continue;
      }

      const site = e.site;
      const known = site && !(site.spread && p.index >= site.args.length - 1);
      const values = known ? site.args[p.index] : undefined;

      if (!values) {
        if (!known)
          s.level(
            s.callbacks,
            "unknown",
            step(u, e.node, `${e.text}, which calls a function it is given`, c),
          );
        continue;
      }

      const fns = this.functionsOf(values);

      for (const g of fns.units) {
        const via = (x: Cause) =>
          step(u, e.node, `passes ${code(g.display)} to ${code(t.display)}, which calls it`, x);
        const bound = this.summaries.get(g)!;

        joinEffects(s, bound, via, { affinity: true });
        s.level(s.callbacks, "known", via(c));

        for (const [q, x] of bound.invokes) s.entry(s.invokes, q, via(x));
      }

      this.invokes(
        s,
        u,
        fns.params,
        e.node,
        `passes a function to ${code(t.display)}, which calls it`,
      );

      if (fns.unknown) {
        const text = `passes ${fns.unknown} to ${code(t.display)}, which calls it`;

        s.level(s.callbacks, "unknown", step(u, e.node, text));
      }
    }
  }

  /**
   * A native call may call back any Lucent code the platform holds (the
   * callbacks and methods it was given) that may run during a call. Code
   * the platform queues on the Lucent thread runs as a turn of its own,
   * after the call and whatever made it, as do compute tasks: the call does
   * none of what they do.
   *
   * What the rest does happens during the call, but in the context its
   * glue enters, not the caller's: module code (callNow, holding the Lucent
   * lock), or, for a callback a component's setup made, the main context,
   * whose code the view analysis checks on its own. So it joins
   * `calledBack`, which the IR's effects count and the owner checks of the
   * caller's context do not. What it does to objects native code passes it
   * is unknown.
   */
  private reenter(s: SummaryBuilder, cause: Cause): void {
    for (const entry of this.entries) {
      if (!entry.reentrant) continue;

      const from = this.summaries.get(entry.unit)!;
      const text = `${cause.text}, which may call back ${code(entry.unit.display)}`;
      const via = (c: Cause) => step(cause.unit, cause.node, text, c);
      const back = s.calledBack;

      for (const [key, c] of [...from.reads.vars, ...from.calledBack.reads])
        s.entry(back.reads, key, via(c));

      for (const [key, c] of [...from.writes.vars, ...from.calledBack.writes])
        s.entry(back.writes, key, via(c));

      const unknown =
        from.reads.unknown ??
        from.writes.unknown ??
        (this.moduleObjects ? from.mutates : undefined) ??
        from.callbacks.unknown ??
        // Functions it calls through parameters no one here binds (a closure's enclosing function's).
        from.invokes.values().next().value ??
        from.calledBack.unknown;

      if (unknown) s.calledBackUnknown(via(unknown));

      s.level(s.callbacks, "known", via(entry.cause));
    }
  }

  /**
   * A unit that mutates an object it did not create and reads module state
   * holding objects may be mutating that state: nothing proves they differ.
   */
  private reach(s: SummaryBuilder, u: Unit): void {
    const mutates = s.mutates;
    if (!mutates) return;

    for (const [key, c] of s.reads.vars) {
      const v = this.keys.get(key);
      if (!v?.reference || s.writes.vars.has(key)) continue;

      const text = `${mutates.text}, which may be module state ${code(v.name)} it reads`;

      s.entry(s.writes.vars, key, step(u, mutates.node, text, c));
    }
  }

  /** Which parameters escape or are returned, with the callees' current summaries. */
  private params(s: SummaryBuilder, u: Unit): void {
    u.params.forEach((param, index) => {
      if (!ts.isIdentifier(param.name)) return;

      const sym = parameterSymbol(
        this.p.checker,
        param as ts.ParameterDeclaration & { name: ts.Identifier },
      );

      for (const e of this.escapesOf(sym, u, true)) {
        if (e.kind === "returned" && e.unit === u) s.entry(s.returns, index, e.cause);
        else s.entry(s.escapes, index, e.cause);
      }
    });
  }
}

/** Everything a unit may do when another runs it, but its own suspension and open parameters. */
function joinEffects(
  s: SummaryBuilder,
  from: Summary,
  via: (c: Cause) => Cause,
  include: { affinity: boolean },
): void {
  for (const [key, c] of from.reads.vars) s.entry(s.reads.vars, key, via(c));

  for (const [key, c] of from.reads.constants) s.entry(s.reads.constants, key, via(c));

  for (const [key, c] of from.writes.vars) s.entry(s.writes.vars, key, via(c));

  if (from.reads.unknown) s.unknownState("reads", via(from.reads.unknown));

  if (from.writes.unknown) s.unknownState("writes", via(from.writes.unknown));

  if (from.mutates) s.flag("mutates", via(from.mutates));

  levels(s, s.allocates, from.allocates, via);
  levels(s, s.throws, from.throws, via);
  levels(s, s.callbacks, from.callbacks, via);
  levels(s, s.native, from.native, via);
  levels(s, s.blocking, from.blocking, via);

  if (include.affinity) levels(s, s.affinity, from.affinity, via);

  for (const [key, c] of from.calledBack.reads) s.entry(s.calledBack.reads, key, via(c));

  for (const [key, c] of from.calledBack.writes) s.entry(s.calledBack.writes, key, via(c));

  if (from.calledBack.unknown) s.calledBackUnknown(via(from.calledBack.unknown));
}

function levels<K extends string>(
  s: SummaryBuilder,
  into: Levels<K>,
  from: Levels<K>,
  via: (c: Cause) => Cause,
): void {
  for (const key of Object.keys(from) as K[]) {
    const c = from[key];
    if (c) s.level(into, key, via(c));
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);

  if (list) list.push(value);
  else map.set(key, [value]);
}

function isSymbol(v: Value): v is ts.Symbol {
  return !(v instanceof ThisValue) && !isNode(v);
}

function isNode(v: Value): v is ts.Node {
  return !(v instanceof ThisValue) && typeof (v as ts.Node).kind === "number" && "pos" in v;
}
