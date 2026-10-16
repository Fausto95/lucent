import { Counter, Rounding, tally_version } from "lucent:ext/tally";

/** A Lucent class keeps the C++ object: JavaScript uses the class. */
export class Tally {
  #native: Counter;

  constructor(name: string) {
    this.#native = new Counter(name, 2);
  }

  add(by: number): number {
    return this.#native.add(by);
  }

  total(): bigint {
    return this.#native.total();
  }

  close(): void {
    this.#native.close();
  }
}

export function version(): number {
  return tally_version();
}

export function rounded(): number {
  const c = new Counter();
  c.setRounding(Rounding.Up);
  const total = c.add(0.25);
  c.close();
  return total;
}
