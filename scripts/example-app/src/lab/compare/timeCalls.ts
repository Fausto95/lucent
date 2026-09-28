// NitroBenchmarks' loops, as its App.js runs them.
import { now } from "../../clock";
import type { AddModule } from "./types";

export const RUNS = 100_000;

export function warmup(m: AddModule): void {
  m.addNumbers(5, 13);
  m.addStrings("hello ", "world");
}

/** Milliseconds for RUNS chained addNumbers(num, 5) calls. */
export function timeNumbers(m: AddModule): number {
  const start = now();
  let num = 0;
  for (let i = 0; i < RUNS; i++) {
    num = m.addNumbers(num, 5);
  }
  const end = now();
  if (num !== RUNS * 5) throw new Error(`addNumbers summed to ${num}`);
  return end - start;
}

/** Milliseconds for RUNS addStrings("hello ", "world") calls. */
export function timeStrings(m: AddModule): number {
  let x = "";
  const start = now();
  for (let i = 0; i < RUNS; i++) {
    x = m.addStrings("hello ", "world");
  }
  const end = now();
  if (x !== "hello world") throw new Error(`addStrings returned ${JSON.stringify(x)}`);
  return end - start;
}
