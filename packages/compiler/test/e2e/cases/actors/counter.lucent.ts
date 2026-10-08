// A module of its own actor: it imports nothing the other module imports.
import { delay } from "lucent:core";

let count = 0;

export function bump(): number {
  count++;
  return count;
}

/** Calls JavaScript, which may call into another module (another actor) and this one again. */
export function around(f: () => number): number {
  const before = count;
  return f() * 10 + (count - before);
}

/** Yields between steps: the other actor's work goes on meanwhile. */
export async function steps(n: number): Promise<number> {
  let total = 0;
  for (let i = 0; i < n; i++) {
    await delay(1);
    total += bump();
  }
  return total;
}
