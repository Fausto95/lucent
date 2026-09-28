// React Native provides performance.now(); not every app's types declare it.
const clock = (globalThis as unknown as { performance: { now(): number } }).performance;

/** Milliseconds from a monotonic clock. */
export function now(): number {
  return clock.now();
}

/** Formats a duration in milliseconds with the precision it deserves. */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return "–";

  return ms < 10 ? ms.toFixed(2) : ms.toFixed(0);
}
