// What lucent:ext/tally does, in JavaScript: the reference run of the
// native-cxx-extension case compares the C++ library against it.
let live = 0;

/**
 * As C++ calls a std::function the binding gave it: what the Lucent
 * function throws doesn't unwind through C++, which gets zero (false);
 * the call throws the first such error once it returns.
 */
function asCxx<A extends unknown[], R>(f: (...args: A) => R): [(...args: A) => R | 0, () => void] {
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

export enum Rounding {
  Down = 0,
  Nearest = 2,
  Up = 3,
}

export class Counter {
  #name: string;
  #step: number;
  #total = 0;
  #history: number[] = [];
  #tags: string[] = [];
  #note: string | undefined;
  #rounding = Rounding.Nearest;
  #listeners: ((name: string, total: number) => void)[] = [];
  #open = true;

  constructor(start?: number | string, step = 1) {
    this.#name = typeof start === "string" ? start : "counter";
    this.#step = typeof start === "string" ? step : 1;
    if (typeof start === "number") this.#total = Math.trunc(start);
    live++;
  }

  add(by: number): number {
    this.#check();
    if (by < 0) throw new Error("add takes a number of at least 0");
    const scaled = by * this.#step;
    const rounded =
      this.#rounding === Rounding.Down
        ? Math.floor(scaled)
        : this.#rounding === Rounding.Up
          ? Math.ceil(scaled)
          : Math.round(scaled);
    this.#total += rounded;
    this.#history.push(rounded);
    // Kept by the counter: each runs at once, during this later call.
    const [call, done] = asCxx((listen: (name: string, total: number) => void) =>
      listen(this.#name, this.#total),
    );
    for (const listen of this.#listeners) call(listen);
    done();
    return this.#total;
  }

  each(visit: (amount: number) => void): void {
    this.#check();
    const [call, done] = asCxx(visit);
    for (const amount of this.#history) call(amount);
    done();
  }

  countTags(keep: (tag: string, index: bigint) => boolean): number {
    this.#check();
    const [call, done] = asCxx(keep);
    let kept = 0;
    this.#tags.forEach((tag, i) => {
      if (call(tag, BigInt(i))) kept++;
    });
    done();
    return kept;
  }

  addUntil(by: number, times: number, stop?: AbortSignal): number {
    this.#check();
    if (stop?.aborted) throw stop.reason;
    let thrown: { error: unknown } | undefined;
    // The flag is read each add: a listener may abort it.
    const aborted = () => stop?.aborted === true;
    for (let i = 0; i < times && !aborted(); i++) {
      try {
        this.add(by);
      } catch (error) {
        thrown ??= { error };
      }
    }
    if (stop?.aborted) throw stop.reason;
    if (thrown) throw thrown.error;
    return this.#total;
  }

  onAdd(listen: (name: string, total: number) => void): void {
    this.#check();
    this.#listeners.push(listen);
  }

  total(): bigint {
    this.#check();
    return BigInt(Math.trunc(this.#total));
  }

  name(): string {
    this.#check();
    return this.#name;
  }

  rename(name: string): void {
    this.#check();
    this.#name = name;
  }

  history(): number[] {
    this.#check();
    return [...this.#history];
  }

  tags(): string[] {
    this.#check();
    return [...this.#tags];
  }

  tag(tags: string[]): void {
    this.#check();
    this.#tags.push(...tags);
  }

  note(): string | undefined {
    this.#check();
    return this.#note;
  }

  setNote(note: string | undefined): void {
    this.#check();
    this.#note = note;
  }

  setRounding(rounding: Rounding): void {
    this.#check();
    this.#rounding = rounding;
  }

  rounding(): Rounding {
    this.#check();
    return this.#rounding;
  }

  merge(other: Counter): void {
    this.#check();
    this.#total += other.#total;
  }

  split(): Counter {
    this.#check();
    const half = new Counter(`${this.#name}/2`, this.#step);
    half.#total = Math.floor(this.#total / 2);
    this.#total -= half.#total;
    return half;
  }

  fail(): void {
    this.#check();
    throw new Error("Counter.fail threw a C++ exception");
  }

  static live(): number {
    return live;
  }

  close(): void {
    if (!this.#open) return;
    this.#open = false;
    live--;
  }

  [Symbol.dispose](): void {
    this.close();
  }

  #check(): void {
    if (!this.#open) {
      const e = new Error("Counter is closed");
      e.name = "InvalidStateError";
      throw e;
    }
  }
}

export function tally_version(): number {
  return 3;
}
