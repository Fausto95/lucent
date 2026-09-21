import type { Counter } from "./counter.lucent";
import { event } from "@lucent-lang/events";
import { abs, sqrt } from "@lucent-lang/std/math";
import { now } from "@lucent-lang/platform/clock";
export type Result = { kind: "ok"; value: number } | { kind: "error"; message: string };
export const progress = event<number>();
export function report(value: number): void {
  progress.emit(value);
}
export function advance(counter: Counter): number {
  return counter.increment(1);
}
export function evaluate(value: number): Result {
  if (value < 0) {
    return { kind: "error", message: "Negative" };
  }
  return { kind: "ok", value: sqrt(abs(value)) };
}
export function timestamp(): number {
  return now();
}
/** @thread worker */
export async function double(value: number): Promise<number> {
  return value * 2;
}
