// WeakMap and WeakSet keyed by class instances, interface values and
// objects: entries by identity, no iteration. While a key is held its
// entry stays; native code drops it with the key's last reference, and
// JavaScript when its collector runs (docs/semantics.md).

export class Node {
  constructor(readonly name: string) {}
}

interface Tagged {
  tag(): string;
}

class Item implements Tagged {
  constructor(private readonly text: string) {}

  tag(): string {
    return this.text;
  }
}

type Point = { x: number; y: number };

export function maps(): string {
  const a = new Node("a");
  const b = new Node("b");
  const names = new WeakMap<Node, string>();
  const out: string[] = [];

  out.push(`${names.has(a)} ${names.get(a)}`);
  const same = names.set(a, "first").set(b, "second");
  out.push(`${same === names} ${names.has(a)} ${names.get(a)} ${names.get(b)}`);
  names.set(a, "again");
  out.push(`${names.get(a)}`);
  out.push(`${names.delete(a)} ${names.delete(a)} ${names.has(a)} ${names.get(a)} ${names.get(b)}`);
  // Identity, not equality: another node of the same name is another key.
  out.push(`${names.has(new Node("b"))} ${names.has(b)}`);

  return out.join(" | ");
}

export function sets(): string {
  const a = new Node("a");
  const b = new Node("b");
  const seen = new WeakSet<Node>();
  const out: string[] = [];

  out.push(`${seen.has(a)} ${seen.add(a) === seen} ${seen.has(a)} ${seen.has(b)}`);
  seen.add(a).add(b);
  out.push(`${seen.delete(a)} ${seen.delete(a)} ${seen.has(a)} ${seen.has(b)}`);

  return out.join(" | ");
}

/** Values are held as they are: an array value is the same array. */
export function values(): string {
  const a = new Node("a");
  const lists = new WeakMap<Node, number[]>();

  lists.set(a, [1]);
  lists.get(a)?.push(2);
  const counts = new WeakMap<Node, { n: number }>();
  counts.set(a, { n: 0 });
  const c = counts.get(a);
  if (c) c.n += 5;

  return `${lists.get(a)?.join(",")} ${counts.get(a)?.n}`;
}

/** An interface value and the instance behind it are one key. */
export function interfaceKeys(): string {
  const item = new Item("x");
  const tagged: Tagged = item;
  const tags = new WeakMap<Tagged, number>();
  const items = new WeakSet<Item>();

  tags.set(tagged, 1);
  items.add(item);
  tags.set(new Item("x"), 2);

  return `${tags.get(item)} ${tags.get(tagged)} ${items.has(item)} ${tagged.tag()}`;
}

/** Object values as keys, by identity. */
export function objectKeys(): string {
  const p: Point = { x: 1, y: 2 };
  const q: Point = { x: 1, y: 2 };
  const labels = new WeakMap<Point, string>();

  labels.set(p, "p");

  return `${labels.get(p)} ${labels.get(q)} ${labels.has(q)}`;
}

/** The common use: a cache of what was computed for each object. */
export function cached(): string {
  const sizes = new WeakMap<Node, number>();
  let computed = 0;
  const size = (n: Node): number => {
    const known = sizes.get(n);
    if (known !== undefined) return known;
    computed++;
    sizes.set(n, n.name.length);
    return n.name.length;
  };
  const long = new Node("long");
  const short = new Node("s");

  return `${size(long)} ${size(short)} ${size(long)} ${size(long)} ${computed}`;
}

const registry = new WeakMap<Node, string>();

/** A module-level WeakMap, reached from several calls. */
export function register(node: Node, label: string): void {
  registry.set(node, label);
}

export function labelOf(node: Node): string {
  return registry.get(node) ?? "none";
}
