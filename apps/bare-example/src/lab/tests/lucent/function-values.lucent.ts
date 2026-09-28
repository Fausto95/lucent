// What Lucent accepts around function values that it cannot compare: a
// test against an absent value, a union member of another type, maps and
// arrays holding functions, and generics that do not compare them.

type F = (x: number) => number;

function double(x: number): number {
  return x * 2;
}

function first<T>(xs: T[]): T | undefined {
  return xs[0];
}

function same<T>(a: T, b: T): boolean {
  return a === b;
}

class Bag<T> {
  items: T[] = [];

  has(x: T): boolean {
    return this.items.includes(x);
  }
}

export function absent(flag: boolean): string {
  const g: F | undefined = flag ? double : undefined;

  return [g === undefined, g !== undefined, g == null].join(" ");
}

export function unions(flag: boolean): string {
  const g: F | string = flag ? double : "x";

  return [g === "x", g !== "x"].join(" ");
}

export function containers(): string {
  const byName = new Map<string, F>([["double", double]]);
  const fs: F[] = [double];
  const f = first(fs);
  const bag = new Bag<number>();

  bag.items.push(3);

  return [byName.get("double")!(2), f ? f(3) : 0, same(1, 1), bag.has(3), fs.length].join(" ");
}
