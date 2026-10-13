// `T | undefined` and `T | null` from JavaScript stay apart wherever they
// sit: an element, an entry, a callback's result or argument, a promise's
// value. The wrong one is a TypeError naming where it was.

const shown = (x: number | string | null | undefined): string =>
  x === undefined ? "u" : x === null ? "n" : String(x);

export function elements(xs: (number | undefined)[]): string {
  return xs.map(shown).join(",");
}

export function nullable(xs: (number | null)[]): string {
  return xs.map(shown).join(",");
}

export function nested(rows: (string | null)[][]): string {
  return rows.map((r) => r.map(shown).join(",")).join("|");
}

export function tuple(t: [string | null, number | undefined]): string {
  return `${shown(t[0])} ${shown(t[1])}`;
}

export function record(r: Record<string, number | undefined>): string {
  return Object.keys(r)
    .map((k) => `${k}=${shown(r[k])}`)
    .join(",");
}

export function map(m: Map<string, number | null>): string {
  return [...m].map(([k, v]) => `${k}=${shown(v)}`).join(",");
}

export function set(s: Set<string | undefined>): string {
  return [...s].map(shown).join(",");
}

export function both(xs: (number | null | undefined)[]): string {
  return xs.map(shown).join(",");
}

export function result(f: () => number | undefined): string {
  return shown(f());
}

export function nullResult(f: () => string | null): string {
  return shown(f());
}

export async function promised(p: Promise<number | null>): Promise<string> {
  return shown(await p);
}

export function taker(): (x: number | null) => string {
  return (x) => shown(x);
}
