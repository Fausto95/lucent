// lucent:ext/tally: lucent-tally's native extension (generated from its header and lucent.json)
/**
 * tally::Counter, a class of lucent-tally's C++ library; close() deletes the object, once.
 */
export declare class Counter {
  constructor();
  constructor(start: number);
  constructor(name: string);
  constructor(name: string, step: number);
  add(by: number): number;
  total(): bigint;
  name(): string;
  rename(name: string): void;
  history(): number[];
  tags(): string[];
  tag(tags: string[]): void;
  note(): string | undefined;
  setNote(note: string | undefined): void;
  setRounding(rounding: Rounding): void;
  rounding(): Rounding;
  merge(other: Counter): void;
  split(): Counter;
  fail(): void;
  static live(): number;
  each(visit: (arg0: number) => void): void;
  countTags(keep: (arg0: string, arg1: bigint) => boolean): number;
  onAdd(listen: (arg0: string, arg1: number) => void): void;
  addUntil(by: number, times: number, stop?: AbortSignal): number;
  /** Deletes the object; later uses throw. Closing again does nothing. */
  close(): void;
  /** close() */
  [Symbol.dispose](): void;
}
export declare enum Rounding {
  Down = 0,
  Nearest = 2,
  Up = 3,
}
export declare function tally_version(): number;

// Not bound:
//   Counter.self: tally::Counter *: who owns the object is unknown; a result by value is a new handle
//   Counter.scale(number): overloads TypeScript can't tell apart, so neither is bound
//   Counter.visit(callback): overloads whose callbacks C++ can't tell apart, so neither is bound
