import { created, largest, toPoint, Vec, type Point } from "./shapes.lucent";
import * as shapes from "./shapes.lucent";

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

/** The same module through a namespace import: its functions, constants and classes. */
export function throughNamespace(): string {
  const v = new shapes.Vec(1, 2).plus(new shapes.Vec(3, 4));
  const p: shapes.Point = shapes.toPoint(v);
  const big = shapes.largest([p, { x: -9, y: 0 }], (q) => q.x * q.x);
  const fromNamespace = shapes.created;

  return `${p.x},${p.y} ${big?.x} ${fromNamespace > 0}`;
}
