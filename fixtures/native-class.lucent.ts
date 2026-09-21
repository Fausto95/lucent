export class Counter {
  value: number = 0;
  constructor(initial: number) { this.value = initial; }
  increment(delta: number): number { this.value += delta; return this.value; }
}
export function makeCounter(initial: number): Counter { return new Counter(initial); }
export function advance(counter: Counter): number { return counter.increment(1); }
