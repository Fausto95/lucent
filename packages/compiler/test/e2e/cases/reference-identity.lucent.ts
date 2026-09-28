// `===` and `!==` on arrays, maps, sets, records, byte views and promises
// compare references, never contents. Every value is made inside the module:
// values crossing the JS boundary are copies, so identity is only observable
// here. Two subarray() views of one range are not compared: Lucent treats
// them as one view (docs/semantics.md).

type Grid = number[][];

function same<T>(a: T, b: T): string {
  return `${a === b}/${a !== b}`;
}

function sameArray(a: number[], b: number[]): boolean {
  return a === b;
}

function differentArray(a: number[], b: number[]): boolean {
  return a !== b;
}

export function arrays(): string {
  const a = [1, 2, 3];
  const b = a;
  const c = [1, 2, 3];
  const grid: Grid = [a, c];

  return [
    a === a,
    a === b,
    a !== b,
    a === c,
    a !== c,
    sameArray(a, b),
    differentArray(a, c),
    grid[0] === a,
    grid[1] === a,
    a.slice() === a,
    same(a, b),
    same(a, c),
  ].join(" ");
}

export function maps(): string {
  const m = new Map<string, number>([["k", 1]]);
  const alias = m;
  const other = new Map<string, number>([["k", 1]]);
  const chained = m.set("j", 2);

  return [m === alias, m !== alias, m === other, m !== other, chained === m, same(m, other)].join(
    " ",
  );
}

export function sets(): string {
  const s = new Set<string>(["x"]);
  const alias = s;
  const other = new Set<string>(["x"]);
  const added = s.add("y");

  return [s === alias, s !== alias, s === other, s !== other, added === s, same(s, alias)].join(
    " ",
  );
}

export function records(): string {
  const r: Record<string, number> = { a: 1 };
  const alias = r;
  const other: Record<string, number> = { a: 1 };
  const index: { [k: string]: number } = r;

  return [r === alias, r !== alias, r === other, r !== other, index === r, same(r, other)].join(
    " ",
  );
}

export function bytes(): string {
  const u = new Uint8Array([1, 2, 3]);
  const alias = u;
  const other = new Uint8Array([1, 2, 3]);
  const view = u.subarray(1);

  return [
    u === alias,
    u !== alias,
    u === other,
    u !== other,
    view === u,
    view === view,
    same(u, alias),
  ].join(" ");
}

export function promises(): string {
  const p = Promise.resolve(1);
  const alias = p;
  const other = Promise.resolve(1);

  return [p === alias, p !== alias, p === other, same(p, alias), same(p, other)].join(" ");
}

export function values(): string {
  const big = 10n ** 30n;

  return [same(big, 10n ** 30n), same(1n, 2n), same("ab", ["a", "b"].join(""))].join(" ");
}

function pick(flag: boolean, a: number[]): number[] | undefined {
  return flag ? a : undefined;
}

function firstOrNull(xs: Map<string, number>[]): Map<string, number> | null {
  return xs[0] ?? null;
}

export function optionals(): string {
  const a = [1];
  const c = [1];
  const hit = pick(true, a);
  const miss = pick(false, a);
  const m = new Map<string, number>();
  const found = firstOrNull([m]);
  const none = firstOrNull([]);
  const u = new Uint8Array(2);
  const maybeBytes: Uint8Array | undefined = u.length > 0 ? u : undefined;

  return [
    hit === a,
    hit !== a,
    hit === c,
    a === hit,
    miss === a,
    miss !== a,
    miss === undefined,
    hit === miss,
    found === m,
    m === found,
    none === m,
    none === null,
    maybeBytes === u,
    u !== maybeBytes,
  ].join(" ");
}

export function unions(): string {
  const a = [1, 2];
  const s = new Set<number>([1]);
  const r: Record<string, string> = {};
  const values: (number[] | Set<number> | Record<string, string> | string)[] = [a, s, r, "a"];
  const x: number[] | string = a;
  const y: number[] | string = [1, 2];
  const z: Set<number> | number = s;

  return [
    values[0] === a,
    values[1] === s,
    values[2] === r,
    values[0] === values[1],
    values[0] !== a,
    x === a,
    a === x,
    y === a,
    x === y,
    x !== y,
    z === s,
    values.indexOf(s),
    values.includes(r),
    values.includes([1, 2]),
  ].join(" ");
}
