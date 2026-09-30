/**
 * The reference for the runtime's UI reactive graph (lucent/reactive.h):
 * the same rules, written as plainly as possible and independently of the
 * C++. Where the runtime pushes marks down its edges and keeps flags to skip
 * work, this searches the whole graph and checks every version on each read,
 * so the two only agree if the runtime's shortcuts are sound.
 *
 * The rules, which docs/architecture.md states for the runtime:
 *
 * - A signal notifies when a write changes its value by Object.is (NaN is
 *   itself, 0 and -0 differ; objects by identity, never by content).
 * - A computed value is lazy: evaluated when read, again only when a source
 *   it read last time changed since (sources checked in the order it read
 *   them, computed sources brought up to date first). An unchanged result
 *   changes nothing downstream. An error is kept and thrown to every reader
 *   until a source changes.
 * - An effect runs once when made, then again when something it read changed
 *   since it read it (the version at its first read in a run counts). Before
 *   it reruns, and when it is disposed, its last run's scope is disposed:
 *   pending tasks cancelled (most recent first), then its cleanups and
 *   nested effects in reverse order, untracked. What a run reads replaces
 *   what the last one read.
 * - Pending effects run in the order they were made, each at most once per
 *   change it depends on. Writes inside a transaction, an effect or a
 *   cleanup wait for it to end; the outermost end runs the pending effects
 *   at once (an update). An effect that would run more than `loopLimit`
 *   times in one update stops it: the loop is reported with the effects
 *   that triggered each other, and the pending effects wait for their next
 *   change.
 * - Nothing tracks outside the synchronous run: cleanups, untracked(),
 *   and whatever runs later (a task's continuation) read without subscribing.
 * - Errors nobody can catch (an effect's, its cleanups', a loop) go to
 *   `onError` with where they came from.
 */

export type Where = "effect" | "effect cleanup" | "effect loop";

export interface Options {
  loopLimit: number;
  onError(error: Error[], where: Where): void;
}

/** A lucent::Scope, as far as the graph uses one. */
export class Scope {
  state: "active" | "disposing" | "disposed" = "active";

  private cleanups = new Map<number, () => void>();
  private nextCleanup = 0;
  private tasks: Task[] = [];

  onDispose(cleanup: () => void): number {
    if (this.state !== "active") {
      cleanup();
      return 0;
    }

    this.cleanups.set(++this.nextCleanup, cleanup);
    return this.nextCleanup;
  }

  remove(id: number): boolean {
    return this.state === "active" && this.cleanups.delete(id);
  }

  /** Every error its cleanups threw, in order; none: empty. */
  dispose(): Error[] {
    if (this.state !== "active") return [];
    this.state = "disposing";

    const errors: Error[] = [];

    for (const task of this.tasks.splice(0).toReversed()) task.settle("cancelled");

    for (const id of [...this.cleanups.keys()].toReversed()) {
      const cleanup = this.cleanups.get(id)!;
      this.cleanups.delete(id);

      try {
        cleanup();
      } catch (e) {
        errors.push(e as Error);
      }
    }

    this.state = "disposed";
    return errors;
  }

  /** A pending task under this scope: cancelled at once if the scope is not active. */
  startTask(listener: (outcome: "succeeded" | "cancelled") => void): Task {
    const task = new Task(this, listener);

    if (this.state === "active") this.tasks.push(task);
    else task.settle("cancelled");

    return task;
  }

  forget(task: Task): void {
    this.tasks = this.tasks.filter((t) => t !== task);
  }
}

/** A lucent::Operation<void>: settles once, the first of success and cancellation. */
export class Task {
  pending = true;

  private scope: Scope;
  private listener: (outcome: "succeeded" | "cancelled") => void;

  constructor(scope: Scope, listener: (outcome: "succeeded" | "cancelled") => void) {
    this.scope = scope;
    this.listener = listener;
  }

  succeed(): boolean {
    if (!this.pending) return false;

    this.scope.forget(this);
    this.settle("succeeded");
    return true;
  }

  settle(outcome: "succeeded" | "cancelled"): void {
    this.pending = false;
    this.listener(outcome);
  }
}

interface Edge {
  node: SignalNode | ComputedNode;
  version: number;
}

class SignalNode {
  readonly kind = "signal";
  version = 0;
  value: unknown;

  constructor(value: unknown) {
    this.value = value;
  }
}

class ComputedNode {
  readonly kind = "computed";
  version = 0;
  value: unknown;
  error: Error | undefined;
  hasValue = false;
  fresh = true;
  computing = false;
  sources: Edge[] = [];
  next: Edge[] | undefined;
  fn: () => unknown;

  constructor(fn: () => unknown) {
    this.fn = fn;
  }
}

class EffectNode {
  readonly kind = "effect";
  fresh = true;
  disposed = false;
  queued = false;
  cause: EffectNode | undefined;
  runs = 0;
  update = -1;
  run: Scope | undefined;
  owner: Scope | undefined;
  registration = 0;
  sources: Edge[] = [];
  next: Edge[] | undefined;
  fn: () => void;
  name: string;
  order: number;

  constructor(fn: () => void, name: string, order: number) {
    this.fn = fn;
    this.name = name;
    this.order = order;
  }
}

type Observer = ComputedNode | EffectNode;

export class Graph {
  readonly root = new Scope();

  private live: EffectNode[] = [];
  private queue: EffectNode[] = [];
  private tracker: Observer | undefined;
  private running: EffectNode | undefined;
  private current: Scope = this.root;
  private batch = 0;
  private computing = 0;
  private flushing = false;
  private updates = 0;
  private made = 0;
  private options: Options;

  constructor(options: Options) {
    this.options = options;
  }

  signal<T>(initial: T) {
    const node = new SignalNode(initial);

    return {
      get: (): T => {
        this.track(node);
        return node.value as T;
      },
      peek: (): T => node.value as T,
      set: (value: T) => this.write(node, value),
    };
  }

  computed<T>(fn: () => T) {
    const node = new ComputedNode(fn);

    const read = (): T => {
      if (node.computing) throw new RangeError("A computed value reads itself");

      this.refresh(node);
      this.track(node);

      if (node.error) throw node.error;
      return node.value as T;
    };

    return { get: read, peek: () => this.untracked(read) };
  }

  effect(fn: () => void, name = "effect") {
    const node = new EffectNode(fn, name, ++this.made);
    const owner = this.current;

    if (owner.state !== "active") {
      node.disposed = true;
    } else {
      node.owner = owner;
      node.registration = owner.onDispose(() => this.dispose(node));
      this.live.push(node);
      this.runEffect(node);
    }

    return { dispose: () => this.dispose(node), disposed: () => node.disposed };
  }

  transaction<T>(fn: () => T): T {
    this.batch++;

    try {
      return fn();
    } finally {
      if (--this.batch === 0) this.flush();
    }
  }

  untracked<T>(fn: () => T): T {
    const outer = this.tracker;
    this.tracker = undefined;

    try {
      return fn();
    } finally {
      this.tracker = outer;
    }
  }

  within<T>(scope: Scope, fn: () => T): T {
    const outer = this.current;
    this.current = scope;

    try {
      return fn();
    } finally {
      this.current = outer;
    }
  }

  /** Where effects, cleanups and tasks made now belong. */
  scope(): Scope {
    return this.current;
  }

  onCleanup(cleanup: () => void): void {
    this.current.onDispose(cleanup);
  }

  private track(node: SignalNode | ComputedNode): void {
    const t = this.tracker;
    if (!t || t.next!.some((e) => e.node === node)) return;

    t.next!.push({ node, version: node.version });
  }

  private write(node: SignalNode, value: unknown): void {
    if (this.computing > 0) {
      const e = new Error("A computed value cannot write a signal");
      e.name = "InvalidStateError";
      throw e;
    }

    if (Object.is(node.value, value)) return;

    node.value = value;
    node.version++;

    // Every live effect that reaches the signal through what it (and its
    // computed sources) read, in their last run or so far in this one.
    const reaches = new Map<Observer, boolean>();
    const depends = (o: Observer): boolean => {
      if (reaches.has(o)) return reaches.get(o)!;

      const edges = [...o.sources, ...(o.next ?? [])];
      const r = edges.some(
        (e) => e.node === node || (e.node.kind === "computed" && depends(e.node)),
      );

      reaches.set(o, r);
      return r;
    };

    for (const e of this.live)
      if (!e.queued && depends(e)) {
        e.queued = true;
        e.cause = this.running;
        this.queue.push(e);
      }

    if (this.batch === 0) this.flush();
  }

  /** Whether a source `o` read changed since, bringing computed sources up to date in order. */
  private stale(o: Observer): boolean {
    if (o.fresh) return true;

    for (const e of o.sources) {
      if (e.node.kind === "computed") this.refresh(e.node);
      if (e.node.version !== e.version) return true;
    }

    return false;
  }

  private refresh(c: ComputedNode): void {
    if (!this.stale(c)) return;

    c.next = [];
    c.computing = true;
    this.computing++;
    const outer = this.tracker;
    this.tracker = c;

    let value: unknown;
    let error: Error | undefined;
    try {
      value = c.fn();
    } catch (e) {
      error = e as Error;
    } finally {
      this.tracker = outer;
      this.computing--;
      c.computing = false;
    }

    c.sources = c.next;
    c.next = undefined;
    c.fresh = false;

    if (error) {
      c.error = error;
      c.version++;
      return;
    }

    const changed = c.error !== undefined || !c.hasValue || !Object.is(c.value, value);
    c.error = undefined;

    if (changed) {
      c.value = value;
      c.hasValue = true;
      c.version++;
    }
  }

  private flush(): void {
    if (this.flushing) return;

    this.flushing = true;
    this.batch++;
    this.updates++;

    while (this.queue.length > 0) {
      const e = this.queue.reduce((a, b) => (b.order < a.order ? b : a));
      this.queue = this.queue.filter((x) => x !== e);
      e.queued = false;

      if (e.disposed || !this.stale(e)) continue;

      if (e.update === this.updates && e.runs >= this.options.loopLimit) {
        this.loop(e);

        for (const q of this.queue) q.queued = false;
        this.queue = [];
        break;
      }

      this.runEffect(e);
    }

    this.batch--;
    this.flushing = false;
  }

  private loop(e: EffectNode): void {
    const chain: EffectNode[] = [];
    let x: EffectNode | undefined = e;

    while (x && !chain.includes(x)) {
      chain.push(x);
      x = x.cause;
    }

    const names = chain.toReversed().map((n) => n.name);
    if (x) names.unshift(x.name);

    this.report(
      [
        new RangeError(
          `Effects kept rerunning: ${names.join(" -> ")} (${e.name} ran ${this.options.loopLimit} times in one update)`,
        ),
      ],
      "effect loop",
    );
  }

  private runEffect(e: EffectNode): void {
    const outerRunning = this.running;
    this.running = e;
    this.batch++;

    if (e.run)
      this.report(
        this.untracked(() => e.run!.dispose()),
        "effect cleanup",
      );

    if (!e.disposed) {
      e.run = new Scope();
      e.fresh = false;

      if (this.flushing) {
        if (e.update !== this.updates) {
          e.update = this.updates;
          e.runs = 0;
        }
        e.runs++;
      }

      e.next = [];
      const outerTracker = this.tracker;
      const outerScope = this.current;
      this.tracker = e;
      this.current = e.run;

      try {
        e.fn();
      } catch (error) {
        this.report([error as Error], "effect");
      } finally {
        this.tracker = outerTracker;
        this.current = outerScope;
      }

      e.sources = e.disposed ? [] : e.next;
      e.next = undefined;
    }

    this.running = outerRunning;
    if (--this.batch === 0) this.flush();
  }

  private dispose(e: EffectNode): void {
    if (e.disposed) return;

    e.disposed = true;
    this.live = this.live.filter((x) => x !== e);
    e.owner?.remove(e.registration);
    e.sources = [];

    this.batch++;
    if (e.run)
      this.report(
        this.untracked(() => e.run!.dispose()),
        "effect cleanup",
      );
    if (--this.batch === 0) this.flush();
  }

  private report(errors: Error[], where: Where): void {
    if (errors.length > 0) this.options.onError(errors, where);
  }
}
