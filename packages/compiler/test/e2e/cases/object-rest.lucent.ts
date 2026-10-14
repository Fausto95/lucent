// Object rest in destructuring (T106): the fields a pattern doesn't name,
// as a new object of the rest's type, or a record without the keys it names.
type Point = { x: number; y: number; z: number; label?: string };

export function fromObject(): string {
  const p: Point = { x: 1, y: 2, z: 3, label: "p" };
  const { x, ...others } = p;
  return `${x} ${JSON.stringify(others)}`;
}

export function unsetOptional(): string {
  const p: Point = { x: 1, y: 2, z: 3 };
  const { y, ...others } = p;
  return `${y} ${JSON.stringify(others)}`;
}

export function renamedAndDefaulted(): string {
  const p: Point = { x: 1, y: 2, z: 3 };
  const { x: first, label = "none", ...others } = p;
  return `${first} ${label} ${JSON.stringify(others)}`;
}

export function fromParameter({ a, ...more }: { a: number; b: string; c: boolean }): string {
  return `${a} ${more.b} ${more.c}`;
}

export function fromRecord(): string {
  const r: Record<string, number> = { a: 1, b: 2, c: 3 };
  const { b, ...others } = r;
  return `${b} ${JSON.stringify(others)} ${Object.keys(others).join(",")} ${Object.keys(r).length}`;
}

export function inAssignment(): string {
  let x = 0;
  let others: { y: number; z: number } = { y: 0, z: 0 };
  ({ x, ...others } = { x: 5, y: 6, z: 7 });
  return `${x} ${others.y} ${others.z}`;
}

export function aNewObject(): string {
  const p = { x: 1, y: 2 };
  const { x, ...copy } = p;
  copy.y = 9;
  return `${x} ${p.y} ${copy.y}`;
}

export function inForOf(): string {
  const out: string[] = [];
  for (const { id, ...data } of [
    { id: 1, v: "a" },
    { id: 2, v: "b" },
  ])
    out.push(`${id}:${data.v}`);
  return out.join(",");
}

export function fromLocal(): number {
  const p = { x: 1, y: 2, z: 3 };
  const { x, ...others } = p;
  return x + others.y + others.z;
}

export function everything(): string {
  const p: Point = { x: 1, y: 2, z: 3 };
  const { ...all } = p;
  return JSON.stringify(all);
}
