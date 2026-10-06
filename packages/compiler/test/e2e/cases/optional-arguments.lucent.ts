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
