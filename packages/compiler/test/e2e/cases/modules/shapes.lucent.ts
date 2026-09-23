export type Point = { x: number; y: number };

export let created = 0;

export class Vec {
  constructor(
    public x: number,
    public y: number,
  ) {
    created++;
  }
  plus(o: Vec): Vec {
    return new Vec(this.x + o.x, this.y + o.y);
  }
}

export function toPoint(v: Vec): Point {
  return { x: v.x, y: v.y };
}

export function largest(xs: Point[], size: (x: Point) => number): Point | undefined {
  let best: Point | undefined;
  for (const x of xs) if (best === undefined || size(x) > size(best)) best = x;
  return best;
}
