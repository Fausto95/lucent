// Another actor's module: no import joins it to counter.lucent.ts.
import { delay } from "lucent:core";

let ticks = 0;

export function tick(f: () => number): number {
  ticks++;
  return f() + 100;
}

export async function later(x: number): Promise<number> {
  const before = ticks;
  await delay(2);
  ticks++;
  return x + (ticks - before);
}
