// JSON.stringify's replacer as a list of keys, and its space (T106).
type Item = { id: number; name: string; tags: string[]; meta?: { a: number; b: string } };

const item: Item = { id: 1, name: 'say "hi"', tags: ["x", "y"], meta: { a: 2, b: "z" } };

export function indented(): string {
  return `${JSON.stringify(item, null, 2)}\n${JSON.stringify(item, undefined, "--")}`;
}

export function picked(): string {
  return JSON.stringify(item, ["name", "id", "meta", "a", "id"]);
}

export function pickedAndIndented(): string {
  return JSON.stringify(item, ["tags", "meta", "b"], 4);
}

export function spaces(): string {
  const many = JSON.stringify([1, [2], {}], null, 20);
  const none = JSON.stringify({ a: [] }, null, 0);
  const long = JSON.stringify({ a: 1 }, null, "abcdefghijklmnop");
  return `${many}\n${none}\n${long}`;
}

export function records(): string {
  const r: Record<string, number> = { z: 1, y: 2, x: 3 };
  return `${JSON.stringify(r, ["x", "z"])}\n${JSON.stringify(r, null, 1)}`;
}

export function fromParameters(keys: string[] | null, space: number | undefined): string {
  return JSON.stringify(item, keys, space);
}

export function scalars(): string {
  return `${JSON.stringify("text", null, 2)} ${JSON.stringify(5, ["a"], 2)} ${JSON.stringify([], null, 2)}`;
}
