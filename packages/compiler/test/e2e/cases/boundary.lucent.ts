// Boundary benchmarks: what crossing between JavaScript and Lucent costs,
// timed by scripts/bench.ts (budgets: scripts/bench-boundary-budgets.json).
// Not an e2e case: the work is trivial, the conversions are what's measured.
export type Point = { x: number; y: number };

export function add(a: number, b: number): number {
  return a + b;
}

export function sumPoints(points: Point[]): number {
  let s = 0;
  for (const p of points) s += p.x + p.y;
  return s;
}

export function makePoints(n: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < n; i++) out.push({ x: i, y: n - i });
  return out;
}

export function sumNumbers(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function concat(a: string, b: string): string {
  return a + b;
}
