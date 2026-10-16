// What lucent:ext/ticker does, in JavaScript: the reference run of the
// native-callbacks case compares the C library against it.
type Visit = (value: number) => void;

/**
 * As C calls a callback: what it throws can't unwind through C, which gets
 * zero (false); the call throws the first such error once it returns.
 */
function asC<A extends unknown[], R>(f: (...args: A) => R): [(...args: A) => R | 0, () => void] {
  let thrown: { error: unknown } | undefined;
  const call = (...args: A): R | 0 => {
    try {
      return f(...args);
    } catch (error) {
      thrown ??= { error };
      return 0;
    }
  };
  return [
    call,
    () => {
      if (thrown) throw thrown.error;
    },
  ];
}

let last: Visit | undefined;
let pending: { done: (doubled: number) => void; value: number }[] = [];

export function ticker_count(from: number, to: number, visit: Visit): void {
  last = visit;
  const [call, done] = asC(visit);
  for (let i = from; i <= to; i++) call(i);
  done();
}

// The last count's visit no longer lives: C's call does nothing.
export function ticker_recall(): void {
  void last;
}

export function ticker_keep(names: string, keep: (name: string, index: bigint) => boolean): number {
  const [call, done] = asC(keep);
  let kept = 0;
  names.split(",").forEach((name, i) => {
    if (call(name, BigInt(i))) kept++;
  });
  done();
  return kept;
}

export function ticker_later(value: number, done: (doubled: number) => void): void {
  pending.push({ done, value });
}

// Each runs once: the second call C makes does nothing.
export function ticker_flush(): void {
  const due = pending;
  pending = [];
  for (const l of due) l.done(l.value * 2);
}

export class Ticker {
  #ticks: ((at: number) => void)[] = [];

  onTick(tick: (at: number) => void): void {
    this.#ticks.push(tick);
  }

  tick(at: number): number {
    for (const t of this.#ticks) {
      const [call, done] = asC(t);
      call(at);
      done();
    }
    return this.#ticks.length;
  }

  // Its ticks end with it: C calls none after its destroy function returns.
  close(): void {
    this.#ticks = [];
  }

  [Symbol.dispose](): void {
    this.close();
  }
}

// Called from another thread, each visit is posted: it runs after the call.
export function ticker_count_threaded(from: number, to: number, visit: Visit): void {
  setTimeout(() => {
    for (let i = from; i <= to; i++) visit(i);
  }, 0);
}

export function ticker_check(value: number, ok: (value: number) => boolean): number {
  const [call, done] = asC(ok);
  const passed = call(value);
  done();
  if (passed) return value;
  throw Object.assign(new Error("not ok"), { code: "7" });
}

// Polls the signal's flag after each step; an abort during the call throws its reason.
export function ticker_steps(most: number, step: (n: number) => void, stop?: AbortSignal): number {
  if (stop?.aborted) throw stop.reason;
  const [call, done] = asC(step);
  // The flag is read each step: a callback may abort it.
  const aborted = () => stop?.aborted === true;
  let n = 0;
  while (n < most && !aborted()) {
    n++;
    call(n);
  }
  if (stop?.aborted) throw stop.reason;
  done();
  return n;
}
