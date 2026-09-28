// Optional values the checker narrows to undefined or null: after an
// assignment, a comparison or typeof, they are that constant.

function show(value: string | undefined): string {
  return value === undefined ? "(none)" : value;
}

function showNull(value: string | null): string {
  return value === null ? "(null)" : value;
}

function lookup(key: string): string | undefined {
  return key === "a" ? "ada" : undefined;
}

export function assigned(): string {
  const s: string | undefined = undefined;

  return `${show(s)} ${String(s)} ${typeof s} ${s === undefined}`;
}

export function assignedLet(fill: boolean): string {
  let s: string | undefined = undefined;
  const before = show(s);

  if (fill) s = "filled";

  return `${before} ${show(s)}`;
}

export function compared(key: string): string {
  const found = lookup(key);

  if (found === undefined) return `missing ${show(found)} ${`${found}`}`;

  return `found ${found}`;
}

export function typeofTest(key: string): string {
  const found = lookup(key);

  if (typeof found === "undefined") return show(found);

  return found.toUpperCase();
}

export function nulled(fill: boolean): string {
  let s: string | null = null;
  const before = showNull(s);

  if (fill) s = "set";

  return `${before} ${String(before === null)} ${showNull(s)}`;
}

export function parameter(value?: number): string {
  if (value === undefined) return `none ${String(value)} ${[value].length}`;

  return `value ${value + 1}`;
}

class Box {
  label?: string;
}

export function field(fill: boolean): string {
  const box = new Box();

  if (fill) box.label = "labelled";

  if (box.label === undefined) return `empty ${show(box.label)}`;

  return box.label;
}

export function loose(kind: number): string {
  const value: string | null | undefined = kind === 0 ? null : kind === 1 ? undefined : "set";

  if (value == null) return `absent ${String(value)}`;

  return value;
}
