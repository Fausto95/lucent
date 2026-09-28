// The reference graph's rules, stated directly: the corpus (corpus.ts)
// compares the runtime with the reference, so the reference must be right on
// its own.
import { describe, expect, it } from "vite-plus/test";
import { Graph, Scope, type Where } from "./reference.ts";
import { corpus, scripted } from "./corpus.ts";

function graph(loopLimit = 100) {
  const errors: string[] = [];
  const g = new Graph({
    loopLimit,
    onError: (list: Error[], where: Where) =>
      errors.push(`${where}: ${list.map((e) => e.message).join("|")}`),
  });

  return { g, errors };
}

describe("the reference reactive graph", () => {
  it("never shows an effect half of a committed pair", () => {
    const { g } = graph();
    const min = g.signal(0);
    const max = g.signal(10);
    const seen: [number, number][] = [];

    g.effect(() => {
      seen.push([min.get(), max.get()]);
    });

    g.transaction(() => {
      min.set(20);
      max.set(30);
    });

    expect(seen).toEqual([
      [0, 10],
      [20, 30],
    ]);
  });

  it("recomputes a diamond once and runs its effect once, consistent", () => {
    const { g } = graph();
    const s = g.signal(1);
    let evaluations = 0;
    const left = g.computed(() => (evaluations++, s.get() + 1));
    const right = g.computed(() => (evaluations++, s.get() * 10));
    const seen: number[][] = [];

    g.effect(() => {
      seen.push([left.get(), right.get()]);
    });
    s.set(2);

    expect(seen).toEqual([
      [2, 10],
      [3, 20],
    ]);
    expect(evaluations).toBe(4);
  });

  it("forgets what a run no longer reads", () => {
    const { g } = graph();
    const flag = g.signal(true);
    const a = g.signal(1);
    const b = g.signal(2);
    let runs = 0;

    g.effect(() => {
      runs++;
      if (flag.get()) a.get();
      else b.get();
    });

    flag.set(false);
    a.set(5);

    expect(runs).toBe(2);
  });

  it("compares by Object.is: identity for objects, never content", () => {
    const { g } = graph();
    const list = [1];
    const s = g.signal(list);
    const z = g.signal(0);
    let runs = 0;

    g.effect(() => {
      runs++;
      s.get();
      z.get();
    });

    list.push(2);
    s.set(list);
    z.set(0);
    expect(runs).toBe(1);

    z.set(-0);
    s.set([1, 2]);
    expect(runs).toBe(3);
  });

  it("disposes a run before the next, untracked, and a scope's effects in reverse", () => {
    const { g } = graph();
    const s = g.signal(0);
    const other = g.signal(0);
    const log: string[] = [];
    const mount = new Scope();

    g.within(mount, () => {
      g.effect(() => {
        s.get();
        g.onCleanup(() => log.push(`first cleanup, other ${other.get()}`));
      });
      g.effect(() => {
        s.get();
        g.onCleanup(() => log.push("second cleanup"));
      });
    });

    s.set(1);
    other.set(1);
    g.transaction(() => mount.dispose());

    expect(log).toEqual([
      "first cleanup, other 0",
      "second cleanup",
      "second cleanup",
      "first cleanup, other 1",
    ]);
  });

  it("stops an update loop and names the effects in it", () => {
    const { g, errors } = graph(5);
    const a = g.signal(0);
    const b = g.signal(0);

    g.effect(() => b.set(a.get() + 1), "ping");
    g.effect(() => a.set(b.get() + 1), "pong");

    expect(errors).toEqual([
      "effect loop: Effects kept rerunning: ping -> pong -> ping (ping ran 5 times in one update)",
    ]);
  });

  it("tracks nothing after the synchronous run", () => {
    const { g } = graph();
    const s = g.signal(0);
    let later: (() => number) | undefined;
    let runs = 0;

    g.effect(() => {
      runs++;
      later = () => s.get();
    });

    later!();
    s.set(1);

    expect(runs).toBe(1);
  });

  it("supersedes a run's task when the effect reruns", () => {
    const { g } = graph();
    const s = g.signal(0);
    const outcomes: string[] = [];
    const tasks: { succeed(): boolean }[] = [];

    g.effect(() => {
      const n = s.get();
      tasks.push(g.scope().startTask((o) => outcomes.push(`${n} ${o}`)));
    });

    s.set(1);

    expect(tasks[0]!.succeed()).toBe(false);
    expect(tasks[1]!.succeed()).toBe(true);
    expect(outcomes).toEqual(["0 cancelled", "1 succeeded"]);
  });

  it("writes the same corpus every time, the scripted scenarios first", () => {
    const text = corpus(5);

    expect(corpus(5)).toBe(text);
    expect(text.startsWith(`scenario ${Object.keys(scripted)[0]}\n`)).toBe(true);
  });
});
