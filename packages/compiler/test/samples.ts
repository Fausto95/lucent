export const counter = `export class Counter {
  value: number = 0;
  constructor(initial: number) { this.value = initial; }
  increment(delta: number): number { this.value += delta; return this.value; }
}
export function make(): Counter { return new Counter(2); }
export function increment(counter: Counter): number { return counter.increment(1); }`;
