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

  history(): number[] {
    return this.#native.history();
  }

  close(): void {
    this.#native.close();
  }
}

/** How many C++ counters exist: a static member function. */
export function live(): number {
  return Counter.live();
}

/** A C function of the C++ header. */
export function version(): number {
  return tally_version();
}

/** The constructor's overloads, by arity and type. */
export function made(): string {
  const a = new Counter();
  const b = new Counter(5);
  const c = new Counter("c");
  const out = `${a.name()} ${a.total()} ${b.total()} ${c.name()}`;

  a.close();
  b.close();
  c.close();
  return out;
}

/** Strings, vectors of them and an optional, both ways. */
export function strings(): string {
  const c = new Counter("héllo");
  c.rename(`${c.name()}!`);
  c.tag(["a", "b"]);
  c.tag(["c"]);
  const before = c.note();
  c.setNote("n");
  const out = `${c.name()} ${c.tags().join(",")} ${before === undefined} ${c.note()}`;

  c.setNote(undefined);
  const cleared = c.note() === undefined;
  c.close();
  return `${out} ${cleared}`;
}

/** An enum, both ways, and a vector of numbers. */
export function rounding(): string {
  const c = new Counter();
  c.setRounding(Rounding.Up);
  c.add(0.25);
  c.setRounding(Rounding.Down);
  c.add(1.75);
  const out = `${c.history().join(",")} ${c.rounding() === Rounding.Down}`;

  c.close();
  return out;
}

/** An object by reference, and a new one by value. */
export function objects(): string {
  const a = new Counter(10);
  const b = new Counter(4);
  a.merge(b);
  const half = a.split();
  const out = `${a.total()} ${half.total()} ${half.name()}`;

  a.close();
  b.close();
  half.close();
  return out;
}

/** What C++ throws is an Error, and the object still works; a closed one throws. */
export function errors(): string {
  const c = new Counter();
  const out: string[] = [];

  try {
    c.add(-1);
  } catch (e) {
    out.push(`${(e as Error).name}: ${(e as Error).message}`);
  }
  try {
    c.fail();
  } catch (e) {
    out.push(`${(e as Error).name}: ${(e as Error).message}`);
  }
  out.push(String(c.add(1)));

  c.close();
  try {
    c.total();
  } catch (e) {
    out.push((e as Error).name);
  }
  return out.join("; ");
}
