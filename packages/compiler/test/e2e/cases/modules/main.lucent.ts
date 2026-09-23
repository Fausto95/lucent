import { created, largest, toPoint, Vec, type Point } from "./shapes.lucent";

export function sum(points: Point[]): Point {
  let v = new Vec(0, 0);
  for (const p of points) v = v.plus(new Vec(p.x, p.y));
  return toPoint(v);
}

export function far(points: Point[]): string {
  const p = largest(points, (q) => q.x * q.x + q.y * q.y);
  return p ? `${p.x},${p.y}` : "none";
}

export function vectorsMade(): number {
  return created;
}
