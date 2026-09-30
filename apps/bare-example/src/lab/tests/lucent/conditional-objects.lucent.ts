// Object literals in the branches of a conditional take the type the
// conditional is used as, like a literal on its own does: a branch
// without an optional field still builds that type.

interface Options {
  name: string;
  size?: number;
}

export function declared(big: boolean): Options {
  const o: Options = big ? { name: "big", size: 10 } : { name: "small" };

  return o;
}

export function returned(big: boolean): Options {
  return big ? { name: "big", size: 10 } : { name: "small" };
}

export function nested(n: number): Options {
  return n > 1 ? { name: "many", size: n } : n === 1 ? { name: "one", size: 1 } : { name: "none" };
}

export function assigned(big: boolean): Options {
  let o: Options = { name: "start" };
  o = big ? { name: "big", size: 10 } : { name: "small" };

  return o;
}

export function passed(big: boolean): string {
  return describe(big ? { name: "big", size: 10 } : { name: "small" });
}

export function listed(big: boolean): Options[] {
  return [big ? { name: "big", size: 10 } : { name: "small" }];
}

export function describe(o: Options): string {
  return `${o.name}:${o.size ?? "none"}`;
}

/** A union of subclasses, converted to their base class member by member. */
class Shape {
  area(): number {
    return 0;
  }
}

class Square extends Shape {
  side = 2;

  override area(): number {
    return this.side * this.side;
  }
}

class Circle extends Shape {
  radius = 1;

  override area(): number {
    return 3 * this.radius * this.radius;
  }
}

export function area(round: boolean): number {
  const either = round ? new Circle() : new Square();
  const shape: Shape = either;

  return shape.area();
}

/** A member that cannot convert, which the value is known not to hold. */
export function areaOf(round: boolean, n: number): number {
  const v: Circle | number = round ? new Circle() : n;

  return (v as Shape).area();
}

export function radiusOf(round: boolean): number {
  const s: Shape | string = round ? new Circle() : "none";

  if (s instanceof Circle) return s.radius;

  return -1;
}

async function later(n: number): Promise<number> {
  return n;
}

/** Promises in the branches of an async function's return, awaited as they are. */
export async function pick(first: boolean): Promise<number> {
  return first ? later(1) : later(2);
}
