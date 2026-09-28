function first<T>(xs: T[]): T | undefined {
  return xs[0];
}

function mapPairs<A, B>(xs: A[], f: (a: A) => B): [A, B][] {
  return xs.map((x) => [x, f(x)]);
}

class Queue<T> {
  private items: T[] = [];
  push(item: T): void {
    this.items.push(item);
  }
  shift(): T | undefined {
    return this.items.shift();
  }
  get size(): number {
    return this.items.length;
  }
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = out.get(k);
    if (list) list.push(x);
    else out.set(k, [x]);
  }
  return out;
}

export function demo(): string {
  const q = new Queue<string>();
  q.push("a");
  q.push("b");
  const n = new Queue<number>();
  n.push(1);
  const f = first([3, 4]) ?? 0;
  const s = first(["x"]) ?? "";
  const e = first<number>([]);
  const pairs = mapPairs([1, 2], (x) => `#${x}`);
  const groups = groupBy(["apple", "avocado", "banana"], (w) => w.charAt(0));
  const g: string[] = [];
  groups.forEach((v, k) => g.push(`${k}:${v.join("+")}`));
  return `${q.shift()} ${q.size} ${n.shift()} ${f} ${s} ${e === undefined} ${JSON.stringify(pairs)} ${g.join(" ")}`;
}
