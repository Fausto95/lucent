export class Counter {
  private count: number;
  readonly label: string;
  static created = 0;

  constructor(start: number, label: string = "counter") {
    this.count = start;
    this.label = label;
    Counter.created++;
  }

  increment(by: number = 1): number {
    this.count += by;
    return this.count;
  }

  get value(): number {
    return this.count;
  }

  set value(v: number) {
    this.count = Math.max(0, v);
  }

  reset(): this {
    this.count = 0;
    return this;
  }

  static total(): number {
    return Counter.created;
  }

  describe(): string {
    return `${this.label}=${this.count}`;
  }
}

class Node {
  constructor(public value: number, public next: Node | undefined = undefined) {}
}

export class Stack {
  private head: Node | undefined;
  private size = 0;

  push(v: number): void {
    this.head = new Node(v, this.head);
    this.size++;
  }

  pop(): number | undefined {
    const h = this.head;
    if (!h) return undefined;
    this.head = h.next;
    this.size--;
    return h.value;
  }

  get length(): number {
    return this.size;
  }

  toArray(): number[] {
    const out: number[] = [];
    let n = this.head;
    while (n) {
      out.push(n.value);
      n = n.next;
    }
    return out;
  }
}

export function useStack(xs: number[]): string {
  const s = new Stack();
  for (const x of xs) s.push(x);
  const popped = s.pop();
  return `${popped} ${s.length} ${s.toArray().join(",")}`;
}

export function advance(c: Counter, times: number): number {
  for (let i = 0; i < times; i++) c.increment();
  return c.value;
}

export function makeCounter(n: number): Counter {
  return new Counter(n, "made");
}

export function same(a: Counter, b: Counter): boolean {
  return a === b;
}

export class Account {
  private history: number[] = [];
  #secret = 42;
  constructor(readonly owner: string) {}
  deposit(n: number): void {
    if (n <= 0) throw new RangeError("Deposit must be positive");
    this.history.push(n);
  }
  get balance(): number {
    return this.history.reduce((a, b) => a + b, 0);
  }
  secret(): number {
    return this.#secret;
  }
  onEach(f: (n: number) => void): void {
    this.history.forEach((n) => f(n));
  }
}

let checks = 0;
function checked(c: Counter): Counter {
  checks++;
  return c;
}

/** A value whose type is not nullable is never null or undefined; the operand is still evaluated. */
export function presence(c: Counter, s: string, n: number): string {
  const strict = `${c !== null} ${c === undefined} ${null === s} ${undefined !== n} ${checked(c) !== null}`;
  const loose = `${c == null} ${s != undefined} ${checked(c) != null}`;
  return `${strict} | ${loose} | ${checks}`;
}

/** Functions held in fields, parameter properties included, called as methods. */
export class Relay {
  last = "";
  private readonly format = (s: string) => `<${s}>`;
  constructor(private readonly onValue: (s: string) => void) {}
  send(s: string): void {
    this.last = this.format(s);
    this.onValue(this.last);
  }
}

export function relayed(): string {
  const seen: string[] = [];
  const r = new Relay((s) => seen.push(s));
  r.send("a");
  r.send("b");
  return `${seen.join(",")} ${r.last}`;
}
