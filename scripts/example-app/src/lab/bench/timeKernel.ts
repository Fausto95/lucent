import { now } from "../../clock";

export type Kernel = (n: number) => number;

/** Best of `runs` timings of `f(n)`, in milliseconds. */
export function timeKernel(f: Kernel, n: number, runs = 3): number {
  let best = Infinity;

  for (let r = 0; r < runs; r++) {
    const start = now();
    f(n);
    best = Math.min(best, now() - start);
  }

  return best;
}
