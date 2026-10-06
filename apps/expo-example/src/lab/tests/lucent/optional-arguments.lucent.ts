// TypeScript tells `T | undefined` from `T | null`: a JavaScript caller
// passing the other absent value fails the boundary check at the call.
export function label(name: string | undefined): string {
  return name === undefined ? "anonymous" : `name ${name.length}`;
}

export function opt(name?: string): string {
  return name === undefined ? "none" : name.toUpperCase();
}

export function orNull(name: string | null): string {
  return name === null ? "null" : name;
}

export function both(name: string | null | undefined): string {
  return name ?? "fallback";
}

type Note = { note?: string };

export function field(r: Note): string {
  return r.note === undefined ? "no note" : r.note.toUpperCase();
}

// Object types alike but for the absent value they admit share a native
// layout: each still takes what TypeScript says it does.
type Unset = { v: string | undefined };
type Nulled = { v: string | null };
type Pair<T> = { a: T };

export function unset(o: Unset): string {
  return o.v === undefined ? "undefined" : o.v;
}

export function nulled(o: Nulled): string {
  return o.v === null ? "null" : o.v;
}

export function pairNull(p: Pair<string | null>): string {
  return p.a === null ? "null" : p.a;
}

export function pairUndefined(p: Pair<string | undefined>): string {
  return p.a === undefined ? "undefined" : p.a;
}
