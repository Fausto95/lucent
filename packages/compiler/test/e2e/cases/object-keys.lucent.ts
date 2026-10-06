// The keys of an object type: an optional field left unset is not one,
// as an object literal without it has no such key in JavaScript. Keys
// come in the type's declaration order (docs/semantics.md), so these
// objects are built in that order.

type Q = { a: number; b?: number | null; c: number; d: string };

export function keys(q: Q): string {
  const looped: string[] = [];

  for (const k in q) looped.push(k);

  return `${Object.keys(q).join()} | ${looped.join()}`;
}

export function built(withB: boolean): string {
  const q: Q = withB ? { a: 1, b: 2, c: 3, d: "x" } : { a: 1, c: 3, d: "x" };

  return keys(q);
}

export function nulled(): string {
  const q: Q = { a: 1, b: 2, c: 3, d: "x" };
  q.b = null;

  return keys(q);
}
