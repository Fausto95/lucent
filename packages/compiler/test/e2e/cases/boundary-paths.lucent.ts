// Where a value JavaScript passes fails its type, as the error names it:
// a rest argument by its number, a record's entry by its key, what a
// callback returns and what a promise resolves with by the callback's or
// promise's own place. The paths are rendered only when a conversion fails.

export function total(...xs: number[]): number {
  let t = 0;
  for (const x of xs) t += x;
  return t;
}

export function sizes(r: Record<string, number[]>): number {
  let n = 0;
  for (const k in r) n += r[k]!.length;
  return n;
}

export function mapped(xs: number[], f: (x: number) => number): number {
  let t = 0;
  for (const x of xs) t += f(x);
  return t;
}

export function nested(r: Record<string, (x: number) => number>): number {
  let t = 0;
  for (const k in r) t += r[k]!(1);
  return t;
}

export async function awaited(p: Promise<number>): Promise<number> {
  return (await p) + 1;
}

export async function asked(f: (q: string) => Promise<string>): Promise<string> {
  return `${await f("q")}!`;
}
