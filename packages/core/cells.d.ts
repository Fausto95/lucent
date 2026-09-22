/**
 * Explicit mutable capture cell (`number` only; user generics are unsupported).
 * Concurrent mutation across executors still requires confinement or synchronization.
 */
export declare class Cell {
  constructor(initial: number);
  value: number;
  dispose(): void;
}
