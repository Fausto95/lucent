// Spreading any iterable into an array literal: maps (their entries),
// sets, their keys, values and entries, strings and generators.

type Entry = [string, number];

export function entries(m: Map<string, number>): Entry[] {
  return [...m];
}

export function withEntry(m: Map<string, number>): Entry[] {
  return [["first", 0], ...m, ["last", 99]];
}

export function keysAndValues(m: Map<string, number>): string {
  const keys = [...m.keys()];
  const values = [...m.values()];
  const pairs = [...m.entries()];

  return `${keys.join(",")} ${values.join(",")} ${pairs.length}`;
}

/** A merge: the later map's values win. */
export function merged(a: Map<string, number>, b: Map<string, number>): Entry[] {
  return [...new Map([...a, ...b])];
}

export function unique(xs: number[]): number[] {
  return [...new Set(xs)];
}

export function union(a: Set<number>, b: Set<number>): number[] {
  return [...new Set([...a, ...b])].sort((x, y) => x - y);
}

/** Elements of another type than the array's. */
export function mixed(s: Set<number>): (number | string)[] {
  return ["start", ...s, "end"];
}

export function chars(s: string): string[] {
  return [...s];
}

function* countTo(n: number): Generator<number> {
  for (let i = 1; i <= n; i++) yield i;
}

export function counted(n: number): number[] {
  return [0, ...countTo(n)];
}
