// Spreading objects into object literals: an object that may be undefined
// spreads as nothing, and an optional field the source leaves unset keeps
// the value written before it, as JavaScript skips keys an object lacks.

type Q = { a: number; b?: number; c: number; d: string };

type Loose = { a?: number; b?: number; c?: number; d: string };

export function maybeFirst(p: Q | undefined): string {
  const r: Loose = { ...p, d: "x" };

  return `${r.a ?? "-"} ${r.b ?? "-"} ${r.c ?? "-"} ${r.d}`;
}

export function maybeLast(p: Q | undefined): string {
  const r: Loose = { d: "x", b: 7, ...p };

  return `${r.a ?? "-"} ${r.b ?? "-"} ${r.c ?? "-"} ${r.d}`;
}

export function maybeReturned(p: Q | undefined): Loose {
  return { ...p, d: "x" };
}

let spreads = 0;

function counted(p: Q | undefined): Q | undefined {
  spreads++;

  return p;
}

export function maybeOnce(p: Q | undefined): string {
  spreads = 0;
  const r: Loose = { ...counted(p), d: "x" };

  return `${spreads} ${r.a ?? "-"}`;
}

type Options = { size: number; color: string; label?: string; width?: number };

type Overrides = { size?: number; color?: string; label?: string; width?: number };

const defaults: Options = { size: 1, color: "red", label: "none", width: 10 };

export function merged(overrides: Overrides): string {
  const o: Options = { ...defaults, ...overrides };

  return `${o.size} ${o.color} ${o.label ?? "-"} ${o.width ?? "-"}`;
}
