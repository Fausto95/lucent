// What lucent:ext/tally does, in JavaScript: the reference run of the
// native-cxx-extension case compares the C++ library against it.
let live = 0;

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
    return this.#total;
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
